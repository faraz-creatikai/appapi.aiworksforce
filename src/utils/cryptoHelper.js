// utils/cryptoHelper.js
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters) stored in your .env file
const ENCRYPTION_KEY = process.env.DATABASE_ENCRYPTION_KEY; 
const IV_LENGTH = 12; // Initialization vector length for GCM

export function encryptKey(plainText) {
  if (!plainText) return null;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Store the IV, Auth Tag, and Ciphertext together split by colons
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptKey(encryptedText) {
  if (!encryptedText) return null;
  
  const [ivHex, authTagHex, encryptedData] = encryptedText.split(':');
  
  const decipher = crypto.createDecipheriv(
    ALGORITHM, 
    Buffer.from(ENCRYPTION_KEY, 'hex'), 
    Buffer.from(ivHex, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}