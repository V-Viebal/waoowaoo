-- AlterTable
ALTER TABLE `NovelPromotionPanel` ADD COLUMN `directorLayout` TEXT NULL;

-- CreateTable
CREATE TABLE `NovelPromotionDirectorShot` (
  `id` VARCHAR(191) NOT NULL,
  `panelId` VARCHAR(191) NOT NULL,
  `cameraId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL DEFAULT '机位',
  `isActive` BOOLEAN NOT NULL DEFAULT false,
  `fov` FLOAT NOT NULL DEFAULT 50,
  `posX` FLOAT NOT NULL DEFAULT 0,
  `posY` FLOAT NOT NULL DEFAULT 1.55,
  `posZ` FLOAT NOT NULL DEFAULT 5.4,
  `targetX` FLOAT NOT NULL DEFAULT 0,
  `targetY` FLOAT NOT NULL DEFAULT 1.05,
  `targetZ` FLOAT NOT NULL DEFAULT 0,
  `imageMediaId` VARCHAR(191) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `NovelPromotionDirectorShot_panelId_idx`(`panelId`),
  CONSTRAINT `NovelPromotionDirectorShot_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `NovelPromotionPanel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `NovelPromotionDirectorShot_imageMediaId_fkey` FOREIGN KEY (`imageMediaId`) REFERENCES `MediaObject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
