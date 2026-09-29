import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// ======================================================
//                   CONTROLLERS
// ======================================================

// GET /api/customer-field-labels
export const getCustomerFieldLabels = async (req, res, next) => {
  try {
    const labels = await prisma.customerFieldLabel.findMany({
      select: {
        fieldKey: true,
        displayLabel: true,
      },
    });

    // convert to map
    const mapped = labels.reduce((acc, item) => {
      acc[item.fieldKey] = item.displayLabel;
      return acc;
    }, {});

    res.status(200).json(mapped);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// PATCH /api/customer-field-labels
export const updateCustomerFieldLabels = async (req, res, next) => {
  try {
    const updates = req.body;

    /*
      [
        { fieldKey: "customerName", displayLabel: "Student Name" },
        { fieldKey: "contactNumber", displayLabel: "" }
      ]
    */

    if (!Array.isArray(updates))
      return next(new ApiError(400, "Invalid payload"));

    await prisma.$transaction(
      updates.map((item) =>
        prisma.customerFieldLabel.upsert({
          where: { fieldKey: item.fieldKey },
          update: { displayLabel: item.displayLabel || "" },
          create: {
            fieldKey: item.fieldKey,
            displayLabel: item.displayLabel || "",
          },
        })
      )
    );

    res.status(200).json({
      success: true,
      message: "Customer labels updated",
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
