import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ImapFlow } from "imapflow";
import dotenv from "dotenv";
dotenv.config();

// 1️⃣ Create ONE pooled transporter for all emails (Saves memory & prevents blocking)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: true, // use true for 465
  pool: true,         // 👈 ENABLES POOLING
  maxConnections: 3,  // 👈 MAX 3 CONNECTIONS AT ONCE
  maxMessages: 100,   // 👈 REUSE CONNECTION 100 TIMES
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Helper function to pause execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const saveToSentFolder = async (rawEmail) => {
  const client = new ImapFlow({
    host: "imap.hostinger.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    logger: false,
  });

  try {
    await client.connect();
    await client.append("INBOX.Sent", rawEmail, ["\\Seen"]);
    console.log("✅ Email successfully saved to INBOX.Sent");
  } catch (error) {
    console.error("❌ Failed to save email to Sent folder:", error);
  } finally {
    await client.logout();
  }
};

// 3️⃣ Generic sendEmail function 
export const sendEmail = async (to, subject, html) => {
  try {
    const mailOptions = {
      from: `"CreatikAI Team" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    };

    const rawEmail = await new MailComposer(mailOptions).compile().build();

    const info = await transporter.sendMail({
      envelope: {
        from: process.env.SMTP_USER,
        to,
      },
      raw: rawEmail,
    });

    console.log("✅ Email sent:", info.response);

    await saveToSentFolder(rawEmail);

    return info;
  } catch (error) {
    console.error("❌ Email error:", error);
    throw error;
  }
};

// 4️⃣ System-generated mail function
export const sendSystemEmail = async (to, userName, password, role) => {
  try {
    let subject = "Your Account Has Been Created";
    let roleSpecificMessage = "";

    switch (role) {
      case "administrator":
        roleSpecificMessage = `
          <p>Welcome aboard as an <b>Administrator</b>!</p>
          <p>You now have full access to manage system operations, city admins, and users.</p>
        `;
        break;
      case "city_admin":
        roleSpecificMessage = `
          <p>Welcome aboard as a <b>City Admin</b>!</p>
          <p>You are now authorized to manage users within your assigned city.</p>
        `;
        break;
      default:
        roleSpecificMessage = `
          <p>Welcome aboard as a <b>User</b>!</p>
          <p>You can now log in and access your assigned city’s services and dashboard.</p>
        `;
        break;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
        <h2 style="color: #333;">Welcome to Our System, ${userName} 👋</h2>
        ${roleSpecificMessage}
        <p>Here are your login details:</p>
        <ul>
          <li><b>Email:</b> ${to}</li>
          <li><b>Password:</b> ${password}</li>
        </ul>
        <p style="color: #d9534f;"><b>⚠️ Please log in and change your password immediately for security purposes.</b></p>
        <br />
        <p>Best Regards,<br/><b>Admin Team</b></p>
      </div>
    `;

    const mailOptions = {
      from: `"System Notification" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    };

    // 👈 Now uses the pooled 'transporter' instead of the redundant 'smtpTransporter'
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ System email sent:", info.response);
    return info;
  } catch (error) {
    console.error("❌ System email error:", error.message);
    throw error;
  }
};

// 5️⃣ NEW: Bulk Campaign Function (Use this for sending your 500 emails)
export const sendBulkCampaign = async (usersArray, subject, htmlContent) => {
  console.log(`🚀 Starting bulk send to ${usersArray.length} users...`);

  for (const user of usersArray) {
    try {
      await sendEmail(user.email, subject, htmlContent);
      
      // 👈 THE MAGIC TRICK: Wait 3 seconds before sending the next one
      // This protects your Hostinger IMAP connection and keeps you unblocked.
      await delay(3000); 

    } catch (error) {
      console.error(`❌ Failed to send to ${user.email}`);
    }
  }

  console.log("✅ Bulk campaign finished!");
};