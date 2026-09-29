// controllers/adminAiApiKey.controller.js
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import { encryptKey } from "../utils/cryptoHelper.js";

/**
 * Save or Update the Master System AI Configuration (Upsert)
 * POST /api/admin/ai-configs
 */
export async function saveAdminAiApiKey(req, res, next) {
  try {
    const { provider, apiKey, model } = req.body;
    const adminId = req.admin?.id; 

    if (!adminId) {
      throw new ApiError(401, "Unauthorized: Admin profile not found");
    }

    // Ensure only the master 'administrator' can set this system-wide key
    const adminProfile = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true }
    });

    if (!adminProfile || adminProfile.role !== "administrator") {
      throw new ApiError(403, "Forbidden: Only master administrators can configure system AI keys");
    }

    if (!provider || !apiKey || !model) {
      throw new ApiError(400, "Provider, API Key, and Model selection are all required fields");
    }

    const validProviders = ["OPENAI", "GEMINI", "ANTHROPIC", "GOOGLE", "MISTRAL", "GROQ", "CUSTOM"];
    if (!validProviders.includes(provider.toUpperCase())) {
      throw new ApiError(400, `Invalid AI Provider. Must be one of: ${validProviders.join(", ")}`);
    }

    const encryptedKeyText = encryptKey(apiKey);
    if (!encryptedKeyText) {
      throw new ApiError(500, "Failed to encrypt the API key");
    }

    const savedConfig = await prisma.adminAiApiKey.upsert({
      where: {
        adminId_provider: {
          adminId: adminId,
          provider: provider.toUpperCase(),
        },
      },
      update: {
        apiKey: encryptedKeyText,
        model: model.trim(),
        status: "ACTIVE",
      },
      create: {
        adminId: adminId,
        provider: provider.toUpperCase(),
        apiKey: encryptedKeyText,
        model: model.trim(),
        status: "ACTIVE",
      },
    });

    return res.status(200).json({
      success: true,
      message: `${provider} system configuration saved successfully using model: ${model}`,
      data: {
        id: savedConfig.id,
        provider: savedConfig.provider,
        model: savedConfig.model,
        status: savedConfig.status,
        updatedAt: savedConfig.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all Master System AI Configurations
 * GET /api/admin/ai-configs
 */
export async function getAdminAiApiKeys(req, res, next) {
  try {
    const adminId = req.admin?.id;

    if (!adminId) {
      throw new ApiError(401, "Unauthorized: Admin profile not found");
    }

    const adminProfile = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true }
    });

    if (!adminProfile || adminProfile.role !== "administrator") {
      throw new ApiError(403, "Forbidden: Only master administrators can view system AI keys");
    }

    // Fetch configs but explicitly exclude the encrypted API key for frontend security
    const aiConfigs = await prisma.adminAiApiKey.findMany({
      where: { adminId: adminId },
      select: {
        id: true,
        provider: true,
        model: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" }
    });

    return res.status(200).json({
      success: true,
      message: "AI configurations retrieved successfully",
      data: aiConfigs,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an existing System AI Configuration (Patch)
 * PUT or PATCH /api/admin/ai-configs/:id
 */
export async function updateAdminAiApiKey(req, res, next) {
  try {
    const { id } = req.params;
    const { apiKey, model, status } = req.body;
    const adminId = req.admin?.id;

    if (!adminId) {
      throw new ApiError(401, "Unauthorized: Admin profile not found");
    }

    if (!id) {
      throw new ApiError(400, "Configuration ID is required");
    }

    const adminProfile = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true }
    });

    if (!adminProfile || adminProfile.role !== "administrator") {
      throw new ApiError(403, "Forbidden: Only master administrators can modify system AI keys");
    }

    // Ensure the config exists and belongs to this master admin
    const existingConfig = await prisma.adminAiApiKey.findUnique({
      where: { id: id },
    });

    if (!existingConfig || existingConfig.adminId !== adminId) {
      throw new ApiError(404, "AI configuration not found");
    }

    // Prepare update payload dynamically based on what was sent
    const updateData = {};

    if (model) {
      updateData.model = model.trim();
    }

    if (status) {
      // Validate status against your Prisma NormalStatus enum (ACTIVE, INACTIVE, etc.)
      const validStatuses = ["ACTIVE", "INACTIVE"]; 
      if (validStatuses.includes(status.toUpperCase())) {
        updateData.status = status.toUpperCase();
      } else {
        throw new ApiError(400, "Invalid status provided");
      }
    }

    if (apiKey) {
      const encryptedKeyText = encryptKey(apiKey);
      if (!encryptedKeyText) throw new ApiError(500, "Failed to encrypt the API key");
      updateData.apiKey = encryptedKeyText;
    }

    if (Object.keys(updateData).length === 0) {
      throw new ApiError(400, "No valid fields provided for update");
    }

    const updatedConfig = await prisma.adminAiApiKey.update({
      where: { id: id },
      data: updateData,
      select: {
        id: true,
        provider: true,
        model: true,
        status: true,
        updatedAt: true,
      }
    });

    return res.status(200).json({
      success: true,
      message: `${updatedConfig.provider} configuration updated successfully`,
      data: updatedConfig,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a System AI Configuration
 * DELETE /api/admin/ai-configs/:id
 */
export async function deleteAdminAiApiKey(req, res, next) {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id;

    if (!adminId) {
      throw new ApiError(401, "Unauthorized: Admin profile not found");
    }

    if (!id) {
      throw new ApiError(400, "Configuration ID is required for deletion");
    }

    // Verify master administrator role
    const adminProfile = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true }
    });

    if (!adminProfile || adminProfile.role !== "administrator") {
      throw new ApiError(403, "Forbidden: Only master administrators can delete system AI keys");
    }

    // Ensure the configuration actually exists before trying to delete it
    const existingConfig = await prisma.adminAiApiKey.findUnique({
      where: { id: id },
    });

    if (!existingConfig) {
      throw new ApiError(404, "AI configuration not found");
    }

    // Perform the deletion
    await prisma.adminAiApiKey.delete({
      where: { id: id },
    });

    return res.status(200).json({
      success: true,
      message: `${existingConfig.provider} configuration deleted successfully.`,
      data: { 
        id: existingConfig.id,
        provider: existingConfig.provider 
      }
    });
  } catch (error) {
    next(error);
  }
}