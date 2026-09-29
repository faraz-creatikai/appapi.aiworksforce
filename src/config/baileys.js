// config/baileys.js
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { getSocket } from '../socket/socket.js';
import fs from 'fs/promises';
import pino from 'pino';

// Verified against Baileys' source (src/Socket/socket.ts, the `genPairQR` loop
// that fires on the `pair-device` stanza):
//   let qrMs = qrTimeout || 60_000   // time to let a QR live
//   qrTimer = setTimeout(genPairQR, qrMs)
//   qrMs = qrTimeout || 20_000       // shorter subsequent qrs
// When `qrTimeout` is left unset (as we do), the FIRST QR of an attempt lives 60s
// and every QR after that lives 20s. Hardcoded in Baileys, not readable from a
// field — so we mirror the two numbers here for reporting purposes only.
const FIRST_QR_TIMEOUT_MS = 60_000;
const SUBSEQUENT_QR_TIMEOUT_MS = 20_000;

let currentSocket = null;

// ── QR state ─────────────────────────────────────────────────────────
let latestQR = null;
let latestQRGeneratedAt = null;
let latestQRRefreshInterval = null; // ms this specific QR frame will live (60_000 or 20_000)

// ── Pairing code state ───────────────────────────────────────────────
let latestPairingCode = null;
let pairingCodeGeneratedAt = null;
let connectionMethod = 'qr'; // 'qr' | 'pairing'
let pendingPhoneNumber = null;

let connectedUserMeta = null;
let intentionallyPaused = false;
let isStarting = false;

let reconnectTimer = null;
let socketGeneration = 0;

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const resetQRTiming = () => {
  latestQR = null;
  latestQRGeneratedAt = null;
  latestQRRefreshInterval = null;
  // pairing state shares the same lifecycle as QR
  latestPairingCode = null;
  pairingCodeGeneratedAt = null;
};

export const initWhatsApp = async (options = {}) => {
  const { method = 'qr', phoneNumber = null } = options;

  if (isStarting || currentSocket) {
    return;
  }

  isStarting = true;
  intentionallyPaused = false;
  connectionMethod = method;
  pendingPhoneNumber = phoneNumber;
  clearReconnectTimer();

  const myGeneration = ++socketGeneration;
  const { version, isLatest } = await fetchLatestBaileysVersion();

  const { state, saveCreds } = await useMultiFileAuthState('whatsapp-auth-folder');

  const sock = makeWASocket({
    version,
    auth: state,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    // Pairing-code linking validates this far more strictly than QR does.
    // A custom string works fine for QR but makes WhatsApp reject the pair with
    // "couldn't link device / check the number" even when the code is correct.
    browser: method === 'pairing' ? Browsers.macOS('Safari') : ['Property CRM', 'Chrome', '1.0.0'],
    defaultQueryTimeoutMs: undefined,
    // NOTE: deliberately NOT setting qrTimeout — see the constants at the top.
    logger: pino({ level: 'silent' })
  });

  let pairingRequestSent = false;

  const requestPairing = async () => {
    if (pairingRequestSent || myGeneration !== socketGeneration) return;
    pairingRequestSent = true;

    try {
      let cleanNumber = pendingPhoneNumber.replace(/[^0-9]/g, '');

      // A 10-digit or 0-prefixed number produces a valid-looking code that can never link.
      if (cleanNumber.length === 10) cleanNumber = `91${cleanNumber}`;
      else if (cleanNumber.length === 11 && cleanNumber.startsWith('0')) cleanNumber = `91${cleanNumber.slice(1)}`;
      if (cleanNumber.length < 11 || cleanNumber.length > 15) {
        throw new Error(`Invalid phone number for pairing: "${cleanNumber}"`);
      }

      const code = await sock.requestPairingCode(cleanNumber);

      if (myGeneration !== socketGeneration) return;

      latestPairingCode = code;
      pairingCodeGeneratedAt = Date.now();

      console.log(`🔑 Pairing code generated for ${cleanNumber}: ${code}`);

      const io = getSocket();
      if (io) {
        io.emit('whatsapp:pairing_code', {
          code,
          generatedAt: pairingCodeGeneratedAt,
        });
      }
    } catch (err) {
      console.error('❌ Failed to request pairing code:', err.message);
      pairingRequestSent = false; // allow the client's "resend" to try again
      const io = getSocket();
      if (io) {
        io.emit('whatsapp:pairing_error', { message: err.message });
      }
    }
  };

  // ⭐ Request the code on a FRESH socket, before Baileys opens a QR pairing
  // session. Waiting for the `qr` event means the server is already mid-QR-pair,
  // so the phone code belongs to a session nobody is listening on — that is the
  // "check the number" alert with a code that looks perfectly correct.
  // The 3s delay lets the noise handshake finish; firing instantly gives a 428.
  if (method === 'pairing' && phoneNumber && !state.creds.registered) {
    setTimeout(() => { requestPairing(); }, 3000);
  }

  sock.ev.on('connection.update', async (update) => {
    if (myGeneration !== socketGeneration) return;

    const { connection, lastDisconnect, qr } = update;
    const io = getSocket();

    // Only broadcast QR frames when we're actually in QR mode, so pairing-mode
    // sessions don't flash a QR code the UI never shows.
    if (qr && connectionMethod !== 'pairing') {
      const now = Date.now();

      // `latestQR` is null exactly when this is the first `qr` event since the
      // last reset — the same condition Baileys' own genPairQR loop uses to
      // decide "first vs subsequent" (see constants at the top).
      const isFirstQrOfAttempt = latestQR === null;
      const refreshInterval = isFirstQrOfAttempt ? FIRST_QR_TIMEOUT_MS : SUBSEQUENT_QR_TIMEOUT_MS;

      latestQR = qr;
      latestQRGeneratedAt = now;
      latestQRRefreshInterval = refreshInterval;

      console.log(`📲 New QR Code generated (expires in ${refreshInterval}ms)`);
      if (io) {
        io.emit('whatsapp:qr', {
          qrString: qr,
          generatedAt: latestQRGeneratedAt,
          refreshInterval,
        });
      }
    }

    if (connection === 'close') {
      resetQRTiming();
      connectedUserMeta = null;

      const error = lastDisconnect?.error;
      const statusCode = new Boom(error)?.output?.statusCode;
      console.log(`⚠️ Connection closed. Reason code: ${statusCode} | Message: ${error?.message || 'Unknown'}`);

      if (intentionallyPaused) {
        console.log("⏸️ QR loop paused. Waiting for UI to wake it up again.");
        currentSocket = null;
        return;
      }

      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
      const isConflict = statusCode === DisconnectReason.replaced || statusCode === 409;
      const shouldReconnect = !isLoggedOut;

      if (io) io.emit('whatsapp:status', { status: 'disconnected' });

      currentSocket = null;

      if (shouldReconnect) {
        const retryDelay = isConflict ? 5000 : 2000;

        // Preserve whichever method/number was in flight so a pairing session
        // survives Baileys' internal "restart required" reconnects instead of
        // silently falling back to QR mid-flow.
        const resumeMethod = connectionMethod;
        const resumePhone = pendingPhoneNumber;

        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (myGeneration === socketGeneration && !currentSocket) {
            initWhatsApp({ method: resumeMethod, phoneNumber: resumePhone });
          }
        }, retryDelay);
      } else {
        console.log('❌ Logged out. Waiting for unpair payload to reach Meta...');

        setTimeout(async () => {
          try {
            await fs.rm('whatsapp-auth-folder', { recursive: true, force: true });
            console.log('🗑️ Auth folder successfully deleted.');
          } catch (err) {
            console.error("Error deleting folder:", err);
          }

          // A logout always resets us back to the default QR flow
          connectionMethod = 'qr';
          pendingPhoneNumber = null;

          clearReconnectTimer();
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (myGeneration === socketGeneration && !currentSocket) {
              initWhatsApp();
            }
          }, 1000);
        }, 5000);
      }
    } else if (connection === 'open') {
      resetQRTiming();
      console.log('✅ WhatsApp connection opened successfully!');

      const rawJid = sock.user?.id;
      const phone = rawJid ? rawJid.split(':')[0] : 'Unknown Number';
      const cleanJid = rawJid ? `${rawJid.split(':')[0]}@s.whatsapp.net` : null;

      const name = sock.user?.name || sock.user?.notify || sock.authState?.creds?.me?.name || 'WhatsApp Account';

      let imageUrl = null;
      if (cleanJid) {
        try {
          imageUrl = await sock.profilePictureUrl(cleanJid, 'image');
        } catch (error) {
          // Ignore missing profile pic errors
        }
      }

      connectedUserMeta = { phone, name, imageUrl };

      if (io) {
        io.emit('whatsapp:status', { status: 'connected', user: connectedUserMeta });
      }
    }
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();

    if (myGeneration !== socketGeneration) return;

    if (connectedUserMeta) {
      const freshName = sock.user?.name || sock.user?.notify || sock.authState?.creds?.me?.name;
      if (freshName && freshName !== connectedUserMeta.name) {
        connectedUserMeta = { ...connectedUserMeta, name: freshName };
        const io = getSocket();
        if (io) io.emit('whatsapp:status', { status: 'connected', user: connectedUserMeta });
      }
    }
  });

  currentSocket = sock;
  isStarting = false;
};

// Dedicated entry point the route calls for pairing-code linking.
// Tears down any idle QR-mode socket first, then restarts in pairing mode.
export const startPairingConnection = async (phoneNumber) => {
  if (!phoneNumber) {
    throw new Error('phoneNumber is required');
  }

  if (currentSocket && !connectedUserMeta) {
    socketGeneration++;
    clearReconnectTimer();
    currentSocket.end(undefined);
    currentSocket = null;
    isStarting = false;
  }

  // Half-finished creds from an earlier QR attempt make Meta reject the pair.
  // Safe here — we only reach this path when nobody is logged in.
  try {
    await fs.rm('whatsapp-auth-folder', { recursive: true, force: true });
    console.log('🗑️ Cleared auth folder for a fresh pairing attempt.');
  } catch { /* folder may not exist */ }

  await new Promise(r => setTimeout(r, 500));

  resetQRTiming();
  await initWhatsApp({ method: 'pairing', phoneNumber });
};

export const getWhatsAppConnectionState = () => {
  if (!currentSocket && !isStarting) return { status: 'loading' };

  if (currentSocket?.user || connectedUserMeta) {
    return {
      status: 'connected',
      user: connectedUserMeta || {
        phone: currentSocket?.user?.id?.split(':')[0] || '',
        name: currentSocket?.user?.name || 'WhatsApp Account',
        imageUrl: null
      }
    };
  }

  // Report pairing state so a page refresh mid-pairing still shows the code
  if (connectionMethod === 'pairing' && latestPairingCode) {
    return {
      status: 'pairing',
      pairingCode: latestPairingCode,
      generatedAt: pairingCodeGeneratedAt,
      phoneNumber: pendingPhoneNumber,
    };
  }

  if (latestQR) {
    return {
      status: 'scanning',
      qrString: latestQR,
      generatedAt: latestQRGeneratedAt,
      // Reuse the interval assigned when this QR was generated rather than
      // recomputing — `latestQR` is already set by now, so re-deriving
      // "first vs subsequent" would always incorrectly say "subsequent".
      refreshInterval: latestQRRefreshInterval,
    };
  }

  return { status: 'loading' };
};

export const getWhatsAppSocket = () => currentSocket;

export const logoutWhatsApp = async () => {
  if (!currentSocket) {
    return { success: true };
  }
  try {
    intentionallyPaused = false;
    console.log("🔄 Sending explicit unpair command to Meta...");

    if (currentSocket.user?.id) {
      try {
        await currentSocket.query({
          tag: 'iq',
          attrs: {
            to: '@s.whatsapp.net',
            type: 'set',
            xmlns: 'md'
          },
          content: [
            {
              tag: 'remove-companion-device',
              attrs: {
                jid: currentSocket.user.id,
                reason: 'user_initiated'
              }
            }
          ]
        });
        console.log("✅ Meta successfully acknowledged unpair command!");
      } catch (iqErr) {
        // Meta instantly drops the TCP connection the millisecond they unpair the
        // device. A "Connection Closed" error here means it worked perfectly.
        console.log("✅ Unpair command sent (Connection dropped intentionally by Meta).");
      }
    }

    await currentSocket.logout().catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 2000));

    return { success: true };
  } catch (err) {
    console.error("Logout failed:", err);
    return { success: false, error: err.message };
  }
};

export const stopWhatsAppIdle = () => {
  if (currentSocket && !connectedUserMeta) {
    clearReconnectTimer();
    intentionallyPaused = true;
    socketGeneration++;
    currentSocket.end(undefined);
    currentSocket = null;
    console.log("🛑 Admin left page. Stopping QR generation to save resources.");
  }
};