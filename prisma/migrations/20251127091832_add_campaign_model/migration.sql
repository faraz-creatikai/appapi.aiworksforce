/*
  Warnings:

  - You are about to alter the column `status` on the `admin` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(1))` to `Enum(EnumId(2))`.

*/
-- AlterTable
ALTER TABLE `admin` MODIFY `status` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active';

-- CreateTable
CREATE TABLE `Campaign` (
    `id` VARCHAR(191) NOT NULL,
    `Name` VARCHAR(191) NOT NULL DEFAULT '',
    `Status` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
