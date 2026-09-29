import { ScriptGenerationAgent } from "../ai/agent.js";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper to match MongoDB format
const transformSalesScript = (ref) => ({
  _id: ref.id,
  Name: ref.Name,
  Content: ref.Content,
  mode: ref.mode,
  metadata: ref.metadata,
  Status: ref.Status,
  createdAt: ref.createdAt,
  updatedAt: ref.updatedAt,
});

// =====================================
// GET ALL SalesScriptS
// =====================================
export const getSalesScript = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where = {
        OR: [
          {
            Name: {
              contains: keyword,
            },
          },
          {
            Content: {
              contains: keyword,
            },
          },
        ],
      };
    }

    const salesScripts = await prisma.salesScript.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(salesScripts.map(transformSalesScript));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// GET PRICE BY ID
// =====================================
export const getSalesScriptById = async (req, res, next) => {
  try {
    const salesScript = await prisma.salesScript.findUnique({
      where: { id: req.params.id },
    });

    if (!salesScript) {
      return next(new ApiError(404, "SalesScript not found"));
    }

    res.status(200).json(transformSalesScript(salesScript));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// CREATE PRICE
// =====================================
export const createSalesScript = async (req, res, next) => {
  try {
    const {
      Name,
      Status,
      userPrompt,
      customerId,
      ScriptContent,
      mode = "hindi"
    } = req.body;

    if (!userPrompt && !ScriptContent) {
      return next(
        new ApiError(
          400,
          "Either userPrompt or ScriptContent is required"
        )
      );
    }

    let ScriptResponse = null;
    let Content = "";
    let metadata = {};

    // If script already provided, skip AI entirely
    if (ScriptContent) {
      Content = ScriptContent;
    } else {
      if (customerId) {
        const baseCustomer = await prisma.customer.findUnique({
          where: { id: customerId },
        });

        if (!baseCustomer) {
          return next(
            new ApiError(404, "Customer not found")
          );
        }

        const followups = await prisma.followup.findMany({
          where: { customerId },
          orderBy: { createdAt: "asc" },
        });

        const customerContext = {
          customer: {
            name: baseCustomer.customerName,
            description: baseCustomer.Description,
            price: baseCustomer.PriceNumber,
            city: baseCustomer.City,
            location: baseCustomer.Location,
            sublocation: baseCustomer.SubLocation,
            campaign: baseCustomer.Campaign,
            customertype: baseCustomer.CustomerType,
            customersubtype: baseCustomer.CustomerSubType
          },
          followups: followups.map((f) => ({
            description: f.Description,
            startdate: f.StartDate,
            followupNextDate: f.FollowupNextDate,
            status: f.Status,
          }))
        };

        ScriptResponse = await ScriptGenerationAgent(
          userPrompt,
          customerContext,
          mode
        );
      } else {
        ScriptResponse = await ScriptGenerationAgent(
          userPrompt,
          {},
          mode
        );
      }

      Content = JSON.stringify(
        ScriptResponse.script
      );

      metadata =
        ScriptResponse.metadata || {};
    }

    const createdRef =
      await prisma.salesScript.create({
        data: {
          Name,
          Status,
          Content,
          mode,
          metadata,
        },
      });

    res
      .status(201)
      .json(transformSalesScript(createdRef));

  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =====================================
// UPDATE SALES SCRIPT
// =====================================
export const updateSalesScript = async (req, res, next) => {
  try {
    const { id } = req.params;

    const {
      Name,
      Status,
      Content,
      userPrompt,
      customerId,
      mode,
      metadata
    } = req.body;

    const updateData = {};

    if (Name !== undefined) updateData.Name = Name;
    if (Status !== undefined) updateData.Status = Status;
    if (mode !== undefined) updateData.mode = mode;

    // Allow manual metadata updates only if AI isn't regenerating
    if (metadata !== undefined) {
      updateData.metadata = metadata;
    }

    // PRIORITY 1:
    // Manual content exists → skip AI completely
    if (Content !== undefined) {
      updateData.Content = Content;
    }

    // PRIORITY 2:
    // No manual content → generate using AI
    else if (userPrompt) {
      let ScriptResponse = null;

      const agentMode = mode || "hindi";

      if (customerId) {
        const baseCustomer =
          await prisma.customer.findUnique({
            where: { id: customerId },
          });

        if (!baseCustomer) {
          return next(
            new ApiError(
              404,
              "Customer not found"
            )
          );
        }

        const followups =
          await prisma.followup.findMany({
            where: { customerId },
            orderBy: {
              createdAt: "asc"
            },
          });

        const customerContext = {
          customer: {
            name:
              baseCustomer.customerName,
            description:
              baseCustomer.Description,
            price:
              baseCustomer.PriceNumber,
            city:
              baseCustomer.City,
            location:
              baseCustomer.Location,
            sublocation:
              baseCustomer.SubLocation,
            campaign:
              baseCustomer.Campaign,
            customertype:
              baseCustomer.CustomerType,
            customersubtype:
              baseCustomer.CustomerSubType
          },

          followups:
            followups.map((f) => ({
              description:
                f.Description,
              startdate:
                f.StartDate,
              followupNextDate:
                f.FollowupNextDate,
              status: f.Status,
            }))
        };

        ScriptResponse =
          await ScriptGenerationAgent(
            userPrompt,
            customerContext,
            agentMode
          );
      } else {
        ScriptResponse =
          await ScriptGenerationAgent(
            userPrompt,
            {},
            agentMode
          );
      }

      updateData.Content =
        ScriptResponse.script;

      updateData.metadata =
        ScriptResponse.metadata || {};
    }

    const updatedRef =
      await prisma.salesScript.update({
        where: { id },
        data: updateData,
      });

    res
      .status(200)
      .json(
        transformSalesScript(
          updatedRef
        )
      );

  } catch (error) {
    if (error.code === "P2025") {
      return next(
        new ApiError(
          404,
          "SalesScript not found"
        )
      );
    }

    next(
      new ApiError(
        400,
        error.message
      )
    );
  }
};

// =====================================
// DELETE PRICE
// =====================================
export const deleteSalesScript = async (req, res, next) => {
  try {
    await prisma.salesScript.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "SalesScript deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "SalesScript not found"));
    }
    next(new ApiError(500, error.message));
  }
};
