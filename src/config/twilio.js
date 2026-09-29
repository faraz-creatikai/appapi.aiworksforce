import twilio from "twilio";
import dotenv from "dotenv";
import { getWhatsAppConnectionState, getWhatsAppSocket, initWhatsApp } from "./baileys.js";

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);


// Add this right below your imports at the top of the file
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

//twilio api
export const sendWhatsApp = async (to, message, imageUrl = null) => {
  try {
    const payload = {
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${to}`,
      body: message,
    };

    //Add media if exists
    if (imageUrl) {
      payload.mediaUrl = [imageUrl]; // must be array
    }

    const result = await client.messages.create(payload);

    console.log("WhatsApp sent:", result.sid);
    return result;
  } catch (error) {
    console.error("WhatsApp error:", error.message);
    throw error;
  }
};


// utility.js
// Import your active Baileys socket from wherever you initialize it


// helper: guess mimetype from a URL's extension (used for document sends)
const getMimeType = (url = "") => {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  const map = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mp4: "video/mp4",
    mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
};

export const sendBaileysWhatsApp = async (to, message, imageUrl = null, extra = {}) => {
  try {
    let sock = getWhatsAppSocket();

    // 1. Wake up engine if asleep
    if (!sock) {
      console.log("🚦 Engine is asleep. Waking up WhatsApp to send message...");
      initWhatsApp();

      let retries = 0;
      while (getWhatsAppConnectionState().status !== 'connected' && retries < 15) {
        await delay(1000);
        retries++;
      }

      sock = getWhatsAppSocket();
      if (!sock || getWhatsAppConnectionState().status !== 'connected') {
        throw new Error("WhatsApp socket failed to connect to Meta in time. Are you logged out?");
      }
    }

    const {
      mediaType = "text",
      fileName = "",
      linkPreview = null,
      location = null,
      poll = null,
      humanize = true,
    } = extra;

    const jid = `${to}@s.whatsapp.net`;

    // 2. Only download media if the template actually requires a file
    let mediaBufferPromise = null;
    const isFileMedia = ["image", "video", "document"].includes(mediaType);

    if (imageUrl && isFileMedia) {
      mediaBufferPromise = fetch(imageUrl)
        .then(res => res.arrayBuffer())
        .then(buf => Buffer.from(buf))
        .catch(err => {
          console.warn("⚠️ Failed to pre-fetch media, falling back to URL stream:", err.message);
          return { url: imageUrl };
        });
    }

    // 3. Humanize delay
    if (humanize) {
      await sock.presenceSubscribe(jid).catch(() => { });
      await delay(200);

      const isRecording = mediaType === "video";
      await sock.sendPresenceUpdate(isRecording ? "recording" : "composing", jid);

      const artificialDelay = isFileMedia ? 800 : (1200 + Math.floor(Math.random() * 1000));
      await delay(artificialDelay);

      await sock.sendPresenceUpdate("paused", jid);
    }

    let content;

    // 4. Build Content explicitly based on our new trusted mediaType
    if (mediaType === "poll" && poll?.name) {
      content = {
        poll: {
          name: poll.name,
          values: poll.options,
          selectableCount: poll.selectableCount || 1,
        },
      };
    } else if (mediaType === "location" && location?.lat && location?.lng) {
      content = {
        location: {
          degreesLatitude: Number(location.lat),
          degreesLongitude: Number(location.lng),
          name: location.name || "",
          address: location.address || "",
        },
      };
    } else if (isFileMedia && imageUrl) {
      const mediaSource = mediaBufferPromise ? (await mediaBufferPromise) : { url: imageUrl };

      if (mediaType === "video") {
        content = { video: mediaSource, caption: message };

        // 🚀 CLOUDINARY ZERO-LOAD THUMBNAIL TRICK (FIXED)
        if (typeof imageUrl === "string" && imageUrl.includes("res.cloudinary.com")) {
          try {
            const cleanUrl = imageUrl.split("?")[0];
            const lastDotIndex = cleanUrl.lastIndexOf(".");

            if (lastDotIndex !== -1) {
              let thumbnailUrl = cleanUrl.substring(0, lastDotIndex) + ".jpg";

              // 1. Force strict JPEG format (f_jpg), limit dimensions to 320x320, and compress (q_50)
              // This guarantees the file size is tiny enough to pass WhatsApp's filter.
              thumbnailUrl = thumbnailUrl.replace("/upload/", "/upload/w_320,h_320,c_limit,q_50,f_jpg/");
              console.log(" thumnail url is ", thumbnailUrl)

              const thumbRes = await fetch(thumbnailUrl);
              if (thumbRes.ok) {
                const thumbBuffer = Buffer.from(await thumbRes.arrayBuffer());

                // 2. Attach the Buffer directly (Baileys loves Buffers)
                content.jpegThumbnail = thumbBuffer;

                // 3. 🛑 THE MISSING INGREDIENT: You MUST declare the dimensions for video thumbnails
                // Without these two lines, WhatsApp silently deletes the thumbnail on the receiving phone.
                content.width = 320;
                content.height = 270;
              }
            }
          } catch (err) {
            console.warn("⚠️ Failed to fetch Cloudinary thumbnail:", err.message);
          }
        }
      } else if (mediaType === "document") {
        content = {
          document: mediaSource,
          mimetype: getMimeType(imageUrl),
          fileName: fileName || imageUrl.split("/").pop() || "file",
          caption: message,
        };
      } else {
        content = { image: mediaSource, caption: message };
      }
    } else {
      // 5. Fallback: Standard Text + Link Previews
      let text = message;
      content = { text };

      if (linkPreview?.sourceUrl) {
        const hasValidThumbnail = typeof linkPreview.thumbnailUrl === "string" && /^https?:\/\//i.test(linkPreview.thumbnailUrl);

        if (!text.includes(linkPreview.sourceUrl)) {
          text = `${text}\n${linkPreview.sourceUrl}`;
          content.text = text;
        }

        let jpegThumbnail;
        if (hasValidThumbnail) {
          try {
            const res = await fetch(linkPreview.thumbnailUrl);
            jpegThumbnail = Buffer.from(await res.arrayBuffer());
          } catch (err) {
            console.warn("⚠️ Failed to fetch link preview thumbnail:", err.message);
          }
        }

        content.linkPreview = {
          "canonical-url": linkPreview.sourceUrl,
          "matched-text": linkPreview.sourceUrl,
          title: linkPreview.title || "",
          description: linkPreview.body || "",
          ...(jpegThumbnail ? { jpegThumbnail } : {}),
        };
      }
    }

    // 6. Send the payload
    const result = await sock.sendMessage(jid, content);

    // If it's a location, send the caption text separately as a follow-up message
    if (mediaType === "location" && message) {
      await delay(500);
      await sock.sendMessage(jid, { text: message });
    }

    console.log("✅ WhatsApp sent:", result?.key?.id);
    return result;
  } catch (error) {
    console.error("❌ WhatsApp error:", error.message);
    throw error;
  }
};

export const sendBaileysWhatsAppDirect = async (to, message, fileBuffer = null, extra = {}) => {
  try {
    let sock = getWhatsAppSocket();

    // 1. 🛑 FIX: Wait if socket is completely missing OR if it's currently reconnecting
    if (!sock || getWhatsAppConnectionState().status !== 'connected') {
      console.log("🚦 WhatsApp engine is reconnecting or asleep. Waiting...");
      if (!sock) initWhatsApp();

      let retries = 0;
      while (getWhatsAppConnectionState().status !== 'connected' && retries < 15) {
        await delay(1000);
        retries++;
      }

      sock = getWhatsAppSocket();
      if (!sock || getWhatsAppConnectionState().status !== 'connected') {
        throw new Error("WhatsApp socket failed to stabilize/connect.");
      }
    }

    const {
      mediaType = "text",
      fileName = "file",
      mimetype = "application/octet-stream",
      location = null,
      poll = null,
      humanize = true,
    } = extra;

    const jid = `${to}@s.whatsapp.net`;

    // 2. 🛑 FIX: Safely wrap presence updates so they never crash the actual send
    if (humanize) {
      await sock.presenceSubscribe(jid).catch(() => { });
      await delay(200);

      const isRecording = mediaType === "video";
      // Added .catch() so a failed typing indicator doesn't kill the message
      await sock.sendPresenceUpdate(isRecording ? "recording" : "composing", jid).catch(() => { });

      const artificialDelay = fileBuffer ? 800 : (1200 + Math.floor(Math.random() * 1000));
      await delay(artificialDelay);

      await sock.sendPresenceUpdate("paused", jid).catch(() => { });
    }

    let content;

    // 3. Build Content
    if (mediaType === "poll" && poll?.name) {
      content = {
        poll: {
          name: poll.name,
          values: poll.options,
          selectableCount: poll.selectableCount || 1,
        },
      };
    } else if (mediaType === "location" && location?.lat && location?.lng) {
      content = {
        location: {
          degreesLatitude: Number(location.lat),
          degreesLongitude: Number(location.lng),
          name: location.name || "",
          address: location.address || "",
        },
      };
    } else if (fileBuffer) {
      if (mediaType === "video") {
        content = { video: fileBuffer, caption: message };
      } else if (mediaType === "document") {
        content = {
          document: fileBuffer,
          mimetype: mimetype,
          fileName: fileName,
          caption: message,
        };
      } else {
        content = { image: fileBuffer, caption: message };
      }
    } else {
      content = { text: message };
    }

    // 4. Send with Auto-Retry
    let result;
    try {
      result = await sock.sendMessage(jid, content);
    } catch (sendError) {
      // If it STILL throws a connection closed (e.g. timeout during a large file upload), retry once.
      if (sendError.message.toLowerCase().includes('close') || sendError.message.toLowerCase().includes('timeout')) {
        console.warn("⚠️ WhatsApp connection dropped during upload. Retrying once...");
        await delay(2000);
        sock = getWhatsAppSocket(); // Grab fresh socket reference
        if (sock && getWhatsAppConnectionState().status === 'connected') {
          result = await sock.sendMessage(jid, content);
        } else {
          throw sendError;
        }
      } else {
        throw sendError;
      }
    }

    // Follow up location with caption if needed safely
    if (mediaType === "location" && message) {
      await delay(500);
      await sock.sendMessage(jid, { text: message }).catch(() => { });
    }

    return result;
  } catch (error) {
    console.error("❌ WhatsApp Direct Send error:", error.message);
    throw error;
  }
};


//digitalsms api
/* export const sendWhatsApp = async (to, message, imageUrl = null) => {
  try {
    // 👉 remove "+" if present
    const mobile = to.replace("+", "");

    // 👉 append image URL if exists
    let finalMessage = message;
    if (imageUrl) {
      finalMessage += ` ${imageUrl}`;
    }

    // 👉 build query params safely
    const params = new URLSearchParams({
      apikey: process.env.DIGITALSMS,
      mobile: mobile,
      msg: finalMessage,
    });

    const url = `https://demo.digitalsms.biz/api/?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
    });

    const data = await response.json(); // or .text() if their API is not JSON

    console.log("WhatsApp sent:", data);

    return {
      sid: data?.message_id || "no-id",
      raw: data,
    };
  } catch (error) {
    console.error("WhatsApp error:", error.message);
    throw error;
  }
}; */


//meta facebook api
// export const sendWhatsApp = async (to, message) => {
//   try {
//     // Format phone (remove '+' if present)
//     const phone = to.replace("+", "").trim();

//     const response = await axios.post(
//       `https://graph.facebook.com/v19.0/${process.env.META_WA_PHONE_ID}/messages`,
//       {
//         messaging_product: "whatsapp",
//         to: phone,
//         type: "text",
//         text: { body: message },
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     console.log("✅ WhatsApp sent:", response.data.messages?.[0]?.id || "Message Sent");
//     return response.data;
//   } catch (error) {
//     const errMsg = error.response?.data?.error?.message || error.message;
//     console.error("❌ WhatsApp error:", errMsg);
//     throw new Error(errMsg);
//   }
// };
