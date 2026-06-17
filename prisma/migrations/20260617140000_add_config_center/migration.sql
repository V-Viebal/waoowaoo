ALTER TABLE `user`
  ADD COLUMN `role` VARCHAR(191) NOT NULL DEFAULT 'user';

ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `artStyleId` VARCHAR(191) NULL;

ALTER TABLE `user_preferences`
  ADD COLUMN `artStyleId` VARCHAR(191) NULL;

CREATE TABLE `brand_configs` (
  `id` VARCHAR(191) NOT NULL,
  `brandName` VARCHAR(191) NOT NULL,
  `logoPath` VARCHAR(191) NOT NULL,
  `faviconPath` VARCHAR(191) NULL,
  `metadataTitle` VARCHAR(191) NOT NULL,
  `metadataDescription` TEXT NULL,
  `updatedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `brand_configs_updatedByUserId_idx` (`updatedByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `brand_configs_updatedByUserId_fkey` FOREIGN KEY (`updatedByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `prompt_definitions` (
  `id` VARCHAR(191) NOT NULL,
  `promptId` VARCHAR(191) NOT NULL,
  `pathStem` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `variableKeys` TEXT NOT NULL,
  `isRegistered` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `prompt_definitions_promptId_key` (`promptId`),
  INDEX `prompt_definitions_category_idx` (`category`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `prompt_versions` (
  `id` VARCHAR(191) NOT NULL,
  `promptDefinitionId` VARCHAR(191) NOT NULL,
  `locale` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `publishedByUserId` VARCHAR(191) NULL,
  `publishedAt` DATETIME(3) NULL,
  `disabledAt` DATETIME(3) NULL,
  `changeNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `prompt_versions_promptDefinitionId_locale_version_key` (`promptDefinitionId`, `locale`, `version`),
  UNIQUE INDEX `prompt_versions_id_promptDefinitionId_locale_key` (`id`, `promptDefinitionId`, `locale`),
  INDEX `prompt_versions_promptDefinitionId_locale_status_publishedAt_idx` (`promptDefinitionId`, `locale`, `status`, `publishedAt`),
  INDEX `prompt_versions_createdByUserId_idx` (`createdByUserId`),
  INDEX `prompt_versions_publishedByUserId_idx` (`publishedByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `prompt_versions_promptDefinitionId_fkey` FOREIGN KEY (`promptDefinitionId`) REFERENCES `prompt_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `prompt_versions_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `prompt_versions_publishedByUserId_fkey` FOREIGN KEY (`publishedByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_prompt_overrides` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `promptDefinitionId` VARCHAR(191) NOT NULL,
  `locale` VARCHAR(191) NOT NULL,
  `promptVersionId` VARCHAR(191) NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `reason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_prompt_overrides_projectId_promptDefinitionId_locale_key` (`projectId`, `promptDefinitionId`, `locale`),
  INDEX `project_prompt_overrides_promptVersionId_idx` (`promptVersionId`),
  INDEX `project_prompt_overrides_promptVersion_scope_idx` (`promptVersionId`, `promptDefinitionId`, `locale`),
  INDEX `project_prompt_overrides_createdByUserId_idx` (`createdByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `project_prompt_overrides_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `project_prompt_overrides_promptDefinitionId_fkey` FOREIGN KEY (`promptDefinitionId`) REFERENCES `prompt_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `project_prompt_overrides_prompt_version_scope_fkey` FOREIGN KEY (`promptVersionId`, `promptDefinitionId`, `locale`) REFERENCES `prompt_versions`(`id`, `promptDefinitionId`, `locale`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `project_prompt_overrides_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `art_styles` (
  `id` VARCHAR(191) NOT NULL,
  `scope` VARCHAR(191) NOT NULL,
  `ownerUserId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `prompt` TEXT NOT NULL,
  `previewImageUrl` TEXT NULL,
  `previewMediaId` VARCHAR(191) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdByUserId` VARCHAR(191) NULL,
  `updatedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `art_styles_scope_enabled_sortOrder_idx` (`scope`, `enabled`, `sortOrder`),
  INDEX `art_styles_ownerUserId_idx` (`ownerUserId`),
  INDEX `art_styles_previewMediaId_idx` (`previewMediaId`),
  INDEX `art_styles_createdByUserId_idx` (`createdByUserId`),
  INDEX `art_styles_updatedByUserId_idx` (`updatedByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `art_styles_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `art_styles_previewMediaId_fkey` FOREIGN KEY (`previewMediaId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `art_styles_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `art_styles_updatedByUserId_fkey` FOREIGN KEY (`updatedByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storyboard_image_versions` (
  `id` VARCHAR(191) NOT NULL,
  `storyboardId` VARCHAR(191) NOT NULL,
  `mode` VARCHAR(191) NOT NULL,
  `imageUrl` TEXT NOT NULL,
  `imageMediaId` VARCHAR(191) NULL,
  `gridPreset` VARCHAR(191) NULL,
  `gridConfig` JSON NULL,
  `promptSnapshot` TEXT NULL,
  `sourcePanelsSnapshot` JSON NULL,
  `inputSnapshot` JSON NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `storyboard_image_versions_storyboardId_createdAt_idx` (`storyboardId`, `createdAt`),
  INDEX `storyboard_image_versions_createdByUserId_idx` (`createdByUserId`),
  INDEX `storyboard_image_versions_imageMediaId_idx` (`imageMediaId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `storyboard_image_versions_storyboardId_fkey` FOREIGN KEY (`storyboardId`) REFERENCES `novel_promotion_storyboards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `storyboard_image_versions_imageMediaId_fkey` FOREIGN KEY (`imageMediaId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `storyboard_image_versions_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `novel_promotion_projects_artStyleId_idx` ON `novel_promotion_projects`(`artStyleId`);
CREATE INDEX `user_preferences_artStyleId_idx` ON `user_preferences`(`artStyleId`);

ALTER TABLE `novel_promotion_projects`
  ADD CONSTRAINT `novel_promotion_projects_artStyleId_fkey` FOREIGN KEY (`artStyleId`) REFERENCES `art_styles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_preferences`
  ADD CONSTRAINT `user_preferences_artStyleId_fkey` FOREIGN KEY (`artStyleId`) REFERENCES `art_styles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
