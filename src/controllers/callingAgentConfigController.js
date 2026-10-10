import prisma from '../config/prismaClient.js';

// GET all configurations
export const getCallingConfigs = async (req, res) => {
    try {
        const configs = await prisma.callingAgentConfig.findMany({
            orderBy: { createdAt: 'desc' },
            include: { admin: { select: { name: true, email: true } } }
        });
        return res.status(200).json({ success: true, configs });
    } catch (error) {
        console.error("Error fetching calling configs:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// CREATE new configuration
export const createCallingConfig = async (req, res) => {
    try {
        const { name, description, apiKey, orgId, workspaceId, appId, appVersion, connectionId, callerNumber,transferNumber, isActive } = req.body;
        const adminId = req.admin?.id || req.user?.id; 

        if (!adminId) return res.status(401).json({ message: "Unauthorized: Admin ID not found" });

        if (isActive) {
            await prisma.callingAgentConfig.updateMany({
                where: { isActive: true },
                data: { isActive: false }
            });
        }

        const newConfig = await prisma.callingAgentConfig.create({
            data: {
                name: name || "Unnamed Agent",
                description: description || "",
                apiKey, orgId, workspaceId, appId,
                appVersion: appVersion ? parseInt(appVersion) : 12,
                connectionId, callerNumber, transferNumber,
                isActive: Boolean(isActive),
                adminId
            }
        });

        return res.status(201).json({ success: true, config: newConfig });
    } catch (error) {
        console.error("Error creating calling config:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// UPDATE configuration
export const updateCallingConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, apiKey, orgId, workspaceId, appId, appVersion, connectionId, callerNumber, transferNumber, isActive } = req.body;

        if (isActive) {
            await prisma.callingAgentConfig.updateMany({
                where: { id: { not: id }, isActive: true },
                data: { isActive: false }
            });
        }

        const updatedConfig = await prisma.callingAgentConfig.update({
            where: { id },
            data: {
                name, description, apiKey, orgId, workspaceId, appId,
                appVersion: appVersion ? parseInt(appVersion) : undefined,
                connectionId, callerNumber, transferNumber,
                isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            }
        });

        return res.status(200).json({ success: true, config: updatedConfig });
    } catch (error) {
        console.error("Error updating calling config:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// DELETE and SET ACTIVE stay exactly the same as before
export const deleteCallingConfig = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.callingAgentConfig.delete({ where: { id } });
        return res.status(200).json({ success: true, message: "Configuration deleted" });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

export const setActiveConfig = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.callingAgentConfig.updateMany({
            where: { isActive: true },
            data: { isActive: false }
        });
        const activeConfig = await prisma.callingAgentConfig.update({
            where: { id },
            data: { isActive: true }
        });
        return res.status(200).json({ success: true, config: activeConfig });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};