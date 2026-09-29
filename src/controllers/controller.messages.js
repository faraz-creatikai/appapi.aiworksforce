import { PrismaClient } from "@prisma/client";
import { sendEmail } from "../config/mailer.js";
import { sendBaileysWhatsApp, sendBaileysWhatsAppDirect, sendWhatsApp } from "../config/twilio.js";
import ApiError from "../utils/ApiError.js";
import { makeCall } from "../config/exotel.js";
import fs from "fs";
import { EmailCampaignAgent } from "../ai/agent.js";

const prisma = new PrismaClient();

// --------------------------------------------
// 🔀 PLACEHOLDER REPLACEMENT (Same Logic)
// --------------------------------------------
// utils/mergeTemplate.js
export function replacePlaceholders(str, customer) {
  if (!str) return str;
  const map = {
    Name: customer.customerName || "",
    City: customer.City || "",
    Campaign: customer.Campaign || "",
    ContactNumber: customer.ContactNumber || "",
    Email: customer.Email || "",
  };
  let out = str;
  for (const [key, val] of Object.entries(map)) {
    out = out.replaceAll(`{{${key}}}`, val);
  }
  // dynamic CustomerFields, e.g. {{CustomerFields.ImprovementArea}}
  if (customer.CustomerFields) {
    for (const [k, v] of Object.entries(customer.CustomerFields)) {
      out = out.replaceAll(`{{CustomerFields.${k}}}`, v ?? "");
    }
  }
  return out;
}

export function mergeAiContentIntoTemplate(templateHtml, aiBody, customer) {
  const filled = replacePlaceholders(templateHtml, customer);
  return filled.includes("{{AI_CONTENT}}")
    ? filled.replace("{{AI_CONTENT}}", aiBody)
    : filled.replace("</body>", `<p>${aiBody}</p></body>`); // fallback if marker missing
}

// --------------------------------------------
// 📌 Fetch Customers
// --------------------------------------------
const fetchTargetCustomers = async ({
  customerIds = [],
  sendToAll = false,
}) => {
  if (sendToAll) {
    return prisma.customer.findMany();
  }
  if (!Array.isArray(customerIds) || customerIds.length === 0) return [];

  return prisma.customer.findMany({
    where: {
      id: { in: customerIds },
    },
  });
};

// ===================================================================
// 📧 SEND EMAIL BY TEMPLATE
// ===================================================================
export const sendEmailByTemplate = async (req, res, next) => {
  try {
    const { templateId, customerIds = [], sendToAll = false } = req.body;
    if (!templateId) return next(new ApiError(400, "templateId is required"));

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });
    if (!template) return next(new ApiError(404, "Template not found"));
    if (template.type !== "email")
      return next(new ApiError(400, "Template type must be 'email'"));

    const customers = await fetchTargetCustomers({ customerIds, sendToAll });
    if (!customers.length) return next(new ApiError(404, "No customers found"));

    const results = [];

    for (const c of customers) {
      try {
        if (!c.Email) {
          results.push({
            id: c.id,
            name: c.customerName,
            status: "skipped_no_email",
          });
          continue;
        }

        const subject = replacePlaceholders(template.subject, c);
        const html = replacePlaceholders(template.body, c);

        const info = await sendEmail(c.Email, subject, html);

        results.push({
          id: c.id,
          email: c.Email,
          status: "sent",
          info: info.messageId || info.response,
        });
      } catch (err) {
        results.push({
          id: c.id,
          name: c.customerName,
          status: "failed",
          error: err.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      sent: results.filter((r) => r.status === "sent").length,
      results,
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

// ===================================================================
// 💬 SEND WHATSAPP BY TEMPLATE
// ===================================================================
export const sendWhatsAppByTemplate = async (req, res, next) => {
  try {
    const { templateId, customerIds = [], sendToAll = false } = req.body;
    if (!templateId) return next(new ApiError(400, "templateId is required"));

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });
    if (!template) return next(new ApiError(404, "Template not found"));
    if (template.type !== "whatsapp")
      return next(new ApiError(400, "Template type must be 'whatsapp'"));

    const customers = await fetchTargetCustomers({ customerIds, sendToAll });
    if (!customers.length) return next(new ApiError(404, "No customers found"));

    const results = [];

    for (const c of customers) {
      try {
        const phone = c.ContactNumber || "";
        if (!phone) {
          results.push({
            id: c.id,
            name: c.customerName,
            status: "skipped_no_phone",
          });
          continue;
        }

        const formattedPhone = phone.startsWith("+")
          ? phone
          : `${process.env.DEFAULT_COUNTRY_CODE || "+91"}${phone}`;

        const message = replacePlaceholders(template.body, c);


        const imageUrl = template.whatsappImage?.[0] || null;

        const result = await sendWhatsApp(
          formattedPhone,
          message,
          imageUrl
        );

        results.push({
          id: c.id,
          phone: formattedPhone,
          status: "sent",
          sid: result.sid,
        });
      } catch (err) {
        results.push({
          id: c.id,
          name: c.customerName,
          status: "failed",
          error: err.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      sent: results.filter((r) => r.status === "sent").length,
      results,
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};




// Helper to pause execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sendBaileysWhatsAppByTemplate = async (req, res, next) => {
  try {
    const { templateId, customerIds = [], sendToAll = false } = req.body;
    if (!templateId) return next(new ApiError(400, "templateId is required"));

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) return next(new ApiError(404, "Template not found"));
    if (template.type !== "whatsapp")
      return next(new ApiError(400, "Template type must be 'whatsapp'"));

    const customers = await fetchTargetCustomers({ customerIds, sendToAll });
    if (!customers.length) return next(new ApiError(404, "No customers found"));

    const results = [];

    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      try {
        const phone = c.ContactNumber || "";
        if (!phone) {
          results.push({
            id: c.id,
            name: c.customerName,
            status: "skipped_no_phone",
          });
          continue;
        }

        // Format for Baileys: Must not contain '+'
        let cleanPhone = phone.replace("+", "");

        // If it's just a 10 digit number, prepend the country code (without +)
        const defaultCode = (process.env.DEFAULT_COUNTRY_CODE || "91").replace("+", "");
        const formattedPhone = cleanPhone.length === 10
          ? `${defaultCode}${cleanPhone}`
          : cleanPhone;

        const message = replacePlaceholders(template.body, c);
        const imageUrl = template.whatsappImage?.[0] || null;


        const extra = {
          mediaType: template.whatsappMediaType || undefined,
          fileName: template.whatsappFileName || undefined,
          linkPreview: template.whatsappLinkPreview || undefined,
          location: template.whatsappLocation || undefined,
          poll: template.whatsappPoll || undefined,
        };

        const result = await sendBaileysWhatsApp(formattedPhone, message, imageUrl, extra);



        results.push({
          id: c.id,
          phone: formattedPhone,
          status: "sent",
          sid: result?.key?.id, // Baileys message ID
        });

        // ⚠️ CRITICAL BAN PROTECTION
        // Pause for 3 to 7 seconds between sending messages to mimic human behavior
        if (i < customers.length - 1) {
          const waitTime = Math.floor(Math.random() * 4000) + 3000;
          await delay(waitTime);
        }

      } catch (err) {
        results.push({
          id: c.id,
          name: c.customerName,
          status: "failed",
          error: err.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      sent: results.filter((r) => r.status === "sent").length,
      results,
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

/**
 * Helper to dynamically construct a well-structured property details template string
 */


/**
 * Helper to dynamically construct a well-structured property details template string
 */
const buildPropertyMessage = (property) => {
  const name = property.customerName || "Featured Property";
  const campaign = property.Campaign ? `[${property.Campaign.toUpperCase()}] ` : "";

  // Combine Type and SubType (e.g., "Commercial - Office Space")
  const propertyType = [property.CustomerType, property.CustomerSubType]
    .filter(Boolean)
    .join(" - ");

  // Combine Location details
  const locationText = [property.SubLocation, property.Location, property.City]
    .filter(Boolean)
    .join(", ");

  let msg = `🏠 *${campaign}${name}*\n`;
  msg += `────────────────────\n\n`;

  if (property.Description) {
    // 1. Remove 10-digit phone numbers (and optional +91 or 0 prefixes)
    let cleanDesc = property.Description.replace(/(?:\+?91[\s-]?)?\b\d{10}\b/g, '');

    // 2. Clean up leftover hanging words like "Contact:- , " or "Call :"
    cleanDesc = cleanDesc.replace(/(?:Contact|Call|Mob|Mobile|Ph|Phone)[\s:,\-]+/gi, ' ');

    // 3. Clean up any weird double commas or extra spaces left behind
    cleanDesc = cleanDesc.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();

    // Only add description if it's not empty after cleaning
    if (cleanDesc) {
      msg += `📝 *Description:*\n${cleanDesc}\n\n`;
    }
  }

  if (propertyType) {
    msg += `🏢 *Type:* ${propertyType}\n`;
  }

  if (locationText) {
    msg += `📍 *Location:* ${locationText}\n`;
  }

  if (property.Area) {
    msg += `📐 *Area:* ${property.Area}\n`;
  }

  if (property.Adderess) {
    msg += `🗺️ *Address:* ${property.Adderess}\n`;
  }

  if (property.Price) {
    msg += `💰 *Price:* ${property.Price}\n`;
  }

  if (property.Facillities) {
    msg += `✨ *Facilities:* ${property.Facillities}\n`;
  }

  if (property.URL) {
    msg += `🔗 *Link:* ${property.URL}\n`;
  }

  msg += `\n────────────────────\n`;
  msg += `📱 *Interested? Contact us for more details!*`;

  return msg;
};

export const sendBaileysWhatsAppProperties = async (req, res, next) => {
  try {
    // 1. Validate inputs
    const { properties = [], customerIds = [], sendToAll = false } = req.body;

    if (!Array.isArray(properties) || properties.length === 0) {
      return next(new ApiError(400, "properties array is required and cannot be empty"));
    }

    // 2. Resolve target customers
    const customers = await fetchTargetCustomers({ customerIds, sendToAll });
    if (!customers.length) return next(new ApiError(404, "No destination customers found"));

    const results = [];

    // Loop through every targeted customer
    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      try {
        const phone = c.ContactNumber || "";
        if (!phone) {
          results.push({
            id: c.id,
            name: c.customerName,
            status: "skipped_no_phone",
          });
          continue;
        }

        // Format for Baileys compatibility
        let cleanPhone = phone.replace("+", "");
        const defaultCode = (process.env.DEFAULT_COUNTRY_CODE || "91").replace("+", "");
        const formattedPhone = cleanPhone.length === 10
          ? `${defaultCode}${cleanPhone}`
          : cleanPhone;

        // Loop through each property in the payload list separately
        for (let j = 0; j < properties.length; j++) {
          const prop = properties[j];

          // Generate the clean layout message
          const messageBody = buildPropertyMessage(prop);

          // Compile all visual media items associated with the listing
          const images = Array.isArray(prop.CustomerImage) ? prop.CustomerImage : [];
          const plans = Array.isArray(prop.SitePlan) ? prop.SitePlan : [];
          const allMediaUrls = [...images, ...plans].filter(Boolean);

          let firstImage = null;
          let extraMediaUrls = [];

          if (allMediaUrls.length > 0) {
            firstImage = allMediaUrls[0];
            extraMediaUrls = allMediaUrls.slice(1);
          }

          // Case A: Property has at least one image - Send text tied to the primary hero image
          if (firstImage) {
            const extra = { mediaType: "image", humanize: j === 0 }; // Only show typing state for the first property block
            await sendBaileysWhatsApp(formattedPhone, messageBody, firstImage, extra);

            // Instantly pipe out any extra property photos or site plans as separate sequential payloads
            for (const mediaUrl of extraMediaUrls) {
              await delay(400); // Small procedural gap to keep deliveries in chronological block order
              await sendBaileysWhatsApp(formattedPhone, "", mediaUrl, { mediaType: "image", humanize: false });
            }
          } else {
            // Case B: Pure text layout
            const extra = { mediaType: "text", humanize: j === 0 };
            await sendBaileysWhatsApp(formattedPhone, messageBody, null, extra);
          }

          // Small delay between sending different property listings to the same customer
          if (j < properties.length - 1) {
            await delay(1000);
          }
        }

        results.push({
          id: c.id,
          phone: formattedPhone,
          status: "sent",
        });

        // ⚠️ ANTI-BAN DELAY (Between distinct customer targets)
        if (i < customers.length - 1) {
          const waitTime = Math.floor(Math.random() * 4000) + 3000;
          await delay(waitTime);
        }

      } catch (err) {
        results.push({
          id: c.id,
          name: c.customerName,
          status: "failed",
          error: err.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      sent: results.filter((r) => r.status === "sent").length,
      results,
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

export const sendDirectWhatsAppMessage = async (req, res, next) => {
  try {
    const { message = "", mediaType = "text", sendToAll = "false" } = req.body;

    const customerIds = req.body.customerIds ? JSON.parse(req.body.customerIds) : [];
    const location = req.body.location ? JSON.parse(req.body.location) : null;
    const poll = req.body.poll ? JSON.parse(req.body.poll) : null;

    // 👇 1. EXTRACT FROM DISK STORAGE
    let file = null;
    let fileBuffer = null;

    if (req.files && req.files["whatsappFile"] && req.files["whatsappFile"].length > 0) {
      file = req.files["whatsappFile"][0];
      // Read the physical file from the 'uploads/' folder into a raw Buffer for Baileys
      fileBuffer = fs.readFileSync(file.path);
    }

    const customers = await fetchTargetCustomers({ customerIds, sendToAll: sendToAll === "true" });
    if (!customers.length) return next(new ApiError(404, "No customers found"));

    const results = [];

    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      try {
        const phone = c.ContactNumber || "";
        if (!phone) {
          results.push({ id: c.id, status: "skipped_no_phone" });
          continue;
        }

        let cleanPhone = phone.replace("+", "");
        const defaultCode = (process.env.DEFAULT_COUNTRY_CODE || "91").replace("+", "");
        const formattedPhone = cleanPhone.length === 10 ? `${defaultCode}${cleanPhone}` : cleanPhone;

        const extra = {
          mediaType,
          location,
          poll,
          fileName: file ? file.originalname : undefined,
          mimetype: file ? file.mimetype : undefined,
          humanize: i === 0
        };

        // 👇 2. PASS THE CONVERTED BUFFER
        const result = await sendBaileysWhatsAppDirect(
          formattedPhone,
          message,
          fileBuffer,
          extra
        );

        results.push({ id: c.id, phone: formattedPhone, status: "sent", sid: result?.key?.id });

        if (i < customers.length - 1) {
          await delay(Math.floor(Math.random() * 4000) + 3000);
        }

      } catch (err) {
        results.push({ id: c.id, status: "failed", error: err.message });
      }
    }

    // 👇 3. CLEAN UP (Delete the temporary file from the uploads folder)
    if (file && file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    res.status(200).json({
      success: true,
      sent: results.filter((r) => r.status === "sent").length,
      results,
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};


export const callCustomer = async (req, res, next) => {
  try {
    const { customerNumber } = req.body;

    if (!customerNumber) {
      res.status(400).json({
        success: false,
        message: "please provide customer number"
      })
      return;
    }
    const response = await makeCall(customerNumber);

    console.log(" making call to customer ", response);
    res.status(200).json({
      success: true,
      call: response
    })
  }
  catch (err) {
    next(new ApiError(500, err.message));
  }
}

export const sendWhatsAppMessage = async (req, res, next) => {
  try {
    const { templateId, customerIds = [] } = req.body;

    if (!templateId) {
      return next(new ApiError(400, "templateId is required"));
    }

    if (!customerIds.length) {
      return next(new ApiError(400, "customerIds are required"));
    }

    // 1. Get template
    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return next(new ApiError(404, "Template not found"));
    }

    if (template.type !== "whatsapp") {
      return next(new ApiError(400, "Template type must be 'whatsapp'"));
    }

    // 2. Get customers
    const customers = await prisma.customer.findMany({
      where: {
        id: { in: customerIds },
      },
    });

    if (!customers.length) {
      return next(new ApiError(404, "No customers found"));
    }

    const results = [];

    // 3. Loop customers (with delay to avoid rate limit)
    for (const c of customers) {
      try {
        const phone = c.ContactNumber || "";

        if (!phone) {
          results.push({
            id: c.id,
            name: c.customerName,
            status: "skipped_no_phone",
          });
          continue;
        }

        const formattedPhone = phone.startsWith("+")
          ? phone
          : `${process.env.DEFAULT_COUNTRY_CODE || "91"}${phone}`;

        // Replace placeholders
        const message = replacePlaceholders(template.body, c);

        // Get first image (if exists)
        const imageUrl = template.whatsappImage?.[0] || null;

        // Build payload
        let payload;

        if (imageUrl) {
          payload = {
            messaging_product: "whatsapp",
            to: formattedPhone,
            type: "image",
            image: {
              link: imageUrl,
              caption: message,
            },
          };
        } else {
          payload = {
            messaging_product: "whatsapp",
            to: formattedPhone,
            type: "text",
            text: {
              body: message,
            },
          };
        }

        const url = `https://graph.facebook.com/v25.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;

        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          results.push({
            id: c.id,
            phone: formattedPhone,
            status: "failed",
            error: data,
          });
          continue;
        }

        results.push({
          id: c.id,
          phone: formattedPhone,
          status: "sent",
          messageId: data?.messages?.[0]?.id || null,
        });

      } catch (err) {
        results.push({
          id: c.id,
          name: c.customerName,
          status: "failed",
          error: err.message,
        });
      }

      // ⛔ small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 300));
    }

    res.status(200).json({
      success: true,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });

  } catch (err) {
    next(new ApiError(500, err.message));
  }
};



function buildCustomerContext(baseCustomer) {
  return {
    customer: {
      customerName: baseCustomer.customerName,
      description: baseCustomer.Description,
      price: baseCustomer.PriceNumber,
      City: baseCustomer.City,
      Location: baseCustomer.Location,
      SubLocation: baseCustomer.SubLocation,
      Campaign: baseCustomer.Campaign,
      CustomerType: baseCustomer.CustomerType,
      CustomerSubType: baseCustomer.CustomerSubType,
      LeadType: baseCustomer.LeadType,
      Email: baseCustomer.Email,
      CustomerFields: baseCustomer.CustomerFields || {},
    },
  };
}

//email template ai campaign send

// Drop-in replacement for sendEmailDirectToCustomers.
// Only change: destructure an optional `templateHtml` from the payload and
// forward it to EmailCampaignAgent so AI drafts can use a chosen template as
// their visual base. Manual sends don't need this — the frontend already
// puts the template's HTML straight into `Body` — but it's accepted here
// too in case you want to log/attribute it later.

export const sendEmailDirectToCustomers = async (req, res, next) => {
  try {
    const {
      customerIds = [],
      sendToAll = false,
      userPrompt,
      Subject,
      Body,
      mode = "english",
      templateHtml, // still comes from frontend for merging — just never sent to AI
    } = req.body;

    if (!userPrompt && !(Subject && Body)) {
      return next(new ApiError(400, "Either userPrompt or Subject & Body is required"));
    }

    const customers = await fetchTargetCustomers({ customerIds, sendToAll });
    if (!customers.length) return next(new ApiError(404, "No customers found"));

    const results = [];

    for (const c of customers) {
      try {
        if (!c.Email) {
          results.push({ id: c.id, name: c.customerName, status: "skipped_no_email" });
          continue;
        }

        let subject = "";
        let body = "";
        let metadata = {};
        let workSummary = "";

        if (userPrompt) {
          const customerContext = buildCustomerContext(c);
          const EmailResponse = await EmailCampaignAgent(
            userPrompt,
            customerContext,
            mode,
            !!templateHtml // just a boolean flag now
          );

          subject = EmailResponse?.email?.subject || "";
          const aiBody = EmailResponse?.email?.body || "";
          metadata = EmailResponse?.metadata || {};
          workSummary = EmailResponse?.workSummary || "";

          if (!subject || !aiBody) {
            results.push({ id: c.id, name: c.customerName, status: "failed", error: "AI failed to generate valid content" });
            continue;
          }

          body = templateHtml ? mergeAiContentIntoTemplate(templateHtml, aiBody, c) : aiBody;
        } else {
          subject = replacePlaceholders(Subject, c);
          body = replacePlaceholders(Body, c);
        }

        const info = await sendEmail(c.Email, subject, body);
        results.push({ id: c.id, email: c.Email, status: "sent", metadata, workSummary, info: info.messageId || info.response });
      } catch (err) {
        results.push({ id: c.id, name: c.customerName, status: "failed", error: err.message });
      }
    }

    res.status(200).json({
      success: true,
      sent: results.filter(r => r.status === "sent").length,
      results,
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

export async function triggerAutoEmail({ customerId, userPrompt, mode = "english" }) {
  if (!customerId) throw new Error("customerId is required");
  if (!userPrompt) throw new Error("userPrompt is required");

  const baseCustomer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!baseCustomer) throw new Error("Customer not found");

  if (!baseCustomer.Email) {
    return { status: "skipped_no_email", customerId };
  }

  const customerContext = buildCustomerContext(baseCustomer);
  const EmailResponse = await EmailCampaignAgent(userPrompt, customerContext, mode);

  const subject = EmailResponse?.email?.subject || "";
  const body = EmailResponse?.email?.body || "";
  const metadata = EmailResponse?.metadata || {};

  if (!subject || !body) {
    throw new Error("AI failed to generate valid subject/body");
  }

  const info = await sendEmail(baseCustomer.Email, subject, body);

  return {
    status: "sent",
    customerId,
    email: baseCustomer.Email,
    subject,
    metadata,
    info: info.messageId || info.response,
  };
}

