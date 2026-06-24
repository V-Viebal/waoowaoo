-- CreateTable
CREATE TABLE `novel_promotion_editor_projects` (
    `id` VARCHAR(191) NOT NULL,
    `episodeId` VARCHAR(191) NOT NULL,
    `projectData` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `renderStatus` ENUM('IDLE', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'IDLE',
    `renderOutputMediaObjectId` VARCHAR(191) NULL,
    `renderSettings` JSON NULL,
    `renderTaskId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `novel_promotion_editor_projects_episodeId_key`(`episodeId`),
    INDEX `novel_promotion_editor_projects_renderOutputMediaObjectId_idx`(`renderOutputMediaObjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `novel_promotion_editor_assets` (
    `id` VARCHAR(191) NOT NULL,
    `editorProjectId` VARCHAR(191) NOT NULL,
    `mediaObjectId` VARCHAR(191) NOT NULL,
    `type` ENUM('VIDEO', 'IMAGE', 'AUDIO') NOT NULL,
    `sourceType` ENUM('GENERATED', 'AI_ENHANCED', 'UPLOADED') NOT NULL,
    `sourcePanelId` VARCHAR(191) NULL,
    `enhanceType` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `novel_promotion_editor_assets_editorProjectId_type_idx`(`editorProjectId`, `type`),
    INDEX `novel_promotion_editor_assets_mediaObjectId_idx`(`mediaObjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `novel_promotion_editor_projects` ADD CONSTRAINT `novel_promotion_editor_projects_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `novel_promotion_editor_projects` ADD CONSTRAINT `novel_promotion_editor_projects_renderOutputMediaObjectId_fkey` FOREIGN KEY (`renderOutputMediaObjectId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `novel_promotion_editor_assets` ADD CONSTRAINT `novel_promotion_editor_assets_editorProjectId_fkey` FOREIGN KEY (`editorProjectId`) REFERENCES `novel_promotion_editor_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `novel_promotion_editor_assets` ADD CONSTRAINT `novel_promotion_editor_assets_mediaObjectId_fkey` FOREIGN KEY (`mediaObjectId`) REFERENCES `media_objects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
