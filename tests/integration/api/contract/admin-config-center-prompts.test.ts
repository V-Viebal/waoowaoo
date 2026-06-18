import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_IDS } from '@/lib/prompt-i18n'
import { PROMPT_VERSION_STATUS } from '@/lib/config-center/prompts/types'
import { callRoute } from '../helpers/call-route'
import { GET as getPrompts } from '@/app/api/admin/config-center/prompts/route'
import { POST as createPromptVersion } from '@/app/api/admin/config-center/prompts/[promptId]/versions/route'
import { PATCH as updatePromptVersionStatus } from '@/app/api/admin/config-center/prompts/[promptId]/versions/[versionId]/route'
import { PUT as upsertPromptOverride } from '@/app/api/admin/config-center/projects/[projectId]/prompt-overrides/route'

const { prismaMock, requireAdminAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    promptDefinition: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    promptVersion: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    projectPromptOverride: {
      upsert: vi.fn(),
    },
  },
  requireAdminAuthMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/admin/auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
}))

const adminAuth = {
  session: { user: { id: 'admin-user-1', email: 'admin@example.com', name: 'Admin' } },
  user: { id: 'admin-user-1', email: 'admin@example.com', name: 'Admin', role: 'admin' },
}

describe('admin config center prompt API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminAuthMock.mockResolvedValue(adminAuth)
  })

  it('returns prompts for admin GET /api/admin/config-center/prompts', async () => {
    const prompts = [
      {
        id: 'definition-1',
        promptId: PROMPT_IDS.NP_SELECT_PROP,
        category: 'novel-promotion',
        name: 'Select prop',
        versions: [{ id: 'version-1', locale: 'zh', version: 1, status: 'published', content: 'hello {input}' }],
      },
    ]
    prismaMock.promptDefinition.findMany.mockResolvedValue(prompts)

    const response = await callRoute(getPrompts, 'GET')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ prompts })
    expect(prismaMock.promptDefinition.findMany).toHaveBeenCalledWith({
      orderBy: [{ category: 'asc' }, { promptId: 'asc' }],
      include: {
        versions: {
          orderBy: [{ locale: 'asc' }, { version: 'desc' }],
          take: 20,
          select: {
            id: true,
            promptDefinitionId: true,
            locale: true,
            version: true,
            status: true,
            content: true,
            createdByUserId: true,
            publishedByUserId: true,
            publishedAt: true,
            disabledAt: true,
            changeNote: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    })
  })

  it('returns admin guard Response as-is and does not query database', async () => {
    requireAdminAuthMock.mockResolvedValue(new Response('blocked', { status: 401 }))

    const response = await callRoute(getPrompts, 'GET')
    const text = await response.text()

    expect(response.status).toBe(401)
    expect(text).toBe('blocked')
    expect(prismaMock.promptDefinition.findMany).not.toHaveBeenCalled()
  })

  it('rejects empty prompt version content', async () => {
    const response = await callRoute(
      createPromptVersion,
      'POST',
      { locale: 'zh', content: '   ' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP } },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.promptDefinition.findUnique).not.toHaveBeenCalled()
  })

  it('rejects draft content missing required catalog variables', async () => {
    prismaMock.promptDefinition.findUnique.mockResolvedValue({
      id: 'definition-1',
      promptId: PROMPT_IDS.NP_SELECT_PROP,
    })

    const response = await callRoute(
      createPromptVersion,
      'POST',
      { locale: 'zh', content: '只包含 {input}' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP } },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(body.error.details.code).toBe('PROMPT_VARIABLES_MISSING')
    expect(body.error.details.missing).toEqual(['props_lib_name'])
    expect(prismaMock.promptVersion.create).not.toHaveBeenCalled()
  })

  it('creates a draft prompt version with next version and admin user id', async () => {
    const createdVersion = {
      id: 'version-3',
      promptDefinitionId: 'definition-1',
      locale: 'zh',
      version: 3,
      status: PROMPT_VERSION_STATUS.DRAFT,
      content: '使用 {input} 和 {props_lib_name}',
      createdByUserId: 'admin-user-1',
      changeNote: '调整模板',
    }
    prismaMock.promptDefinition.findUnique.mockResolvedValue({
      id: 'definition-1',
      promptId: PROMPT_IDS.NP_SELECT_PROP,
    })
    prismaMock.promptVersion.findFirst.mockResolvedValue({ version: 2 })
    prismaMock.promptVersion.create.mockResolvedValue(createdVersion)

    const response = await callRoute(
      createPromptVersion,
      'POST',
      { locale: 'zh', content: '使用 {input} 和 {props_lib_name}', changeNote: '调整模板' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ version: createdVersion })
    expect(prismaMock.promptDefinition.findUnique).toHaveBeenCalledWith({
      where: { promptId: PROMPT_IDS.NP_SELECT_PROP },
    })
    expect(prismaMock.promptVersion.findFirst).toHaveBeenCalledWith({
      where: { promptDefinitionId: 'definition-1', locale: 'zh' },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    expect(prismaMock.promptVersion.create).toHaveBeenCalledWith({
      data: {
        promptDefinitionId: 'definition-1',
        locale: 'zh',
        version: 3,
        status: PROMPT_VERSION_STATUS.DRAFT,
        content: '使用 {input} 和 {props_lib_name}',
        changeNote: '调整模板',
        createdByUserId: 'admin-user-1',
      },
    })
  })

  it('publishes a prompt version with publisher metadata', async () => {
    const publishedVersion = {
      id: 'version-1',
      status: PROMPT_VERSION_STATUS.PUBLISHED,
      publishedByUserId: 'admin-user-1',
    }
    prismaMock.promptVersion.findUnique.mockResolvedValue({
      id: 'version-1',
      promptDefinitionId: 'definition-1',
      locale: 'zh',
      content: '使用 {input} 和 {props_lib_name}',
      promptDefinition: { promptId: PROMPT_IDS.NP_SELECT_PROP },
    })
    prismaMock.promptVersion.update.mockResolvedValue(publishedVersion)

    const response = await callRoute(
      updatePromptVersionStatus,
      'PATCH',
      { action: 'publish' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP, versionId: 'version-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ version: publishedVersion })
    expect(prismaMock.promptVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: {
        status: PROMPT_VERSION_STATUS.PUBLISHED,
        publishedAt: expect.any(Date),
        publishedByUserId: 'admin-user-1',
      },
    })
  })

  it('rejects publishing a prompt version missing required catalog variables', async () => {
    prismaMock.promptVersion.findUnique.mockResolvedValue({
      id: 'version-1',
      promptDefinitionId: 'definition-1',
      locale: 'zh',
      content: '只包含 {input}',
      promptDefinition: { promptId: PROMPT_IDS.NP_SELECT_PROP },
    })

    const response = await callRoute(
      updatePromptVersionStatus,
      'PATCH',
      { action: 'publish' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP, versionId: 'version-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(body.error.details.code).toBe('PROMPT_VARIABLES_MISSING')
    expect(body.error.details.missing).toEqual(['props_lib_name'])
    expect(prismaMock.promptVersion.update).not.toHaveBeenCalled()
  })

  it('disables a prompt version with disabled timestamp', async () => {
    const disabledVersion = {
      id: 'version-1',
      status: PROMPT_VERSION_STATUS.DISABLED,
    }
    prismaMock.promptVersion.findUnique.mockResolvedValue({
      id: 'version-1',
      promptDefinitionId: 'definition-1',
      locale: 'zh',
      content: '只包含 {input}',
      promptDefinition: { promptId: PROMPT_IDS.NP_SELECT_PROP },
    })
    prismaMock.promptVersion.update.mockResolvedValue(disabledVersion)

    const response = await callRoute(
      updatePromptVersionStatus,
      'PATCH',
      { action: 'disable' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP, versionId: 'version-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ version: disabledVersion })
    expect(prismaMock.promptVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: {
        status: PROMPT_VERSION_STATUS.DISABLED,
        disabledAt: expect.any(Date),
      },
    })
  })

  it('rejects invalid prompt version action', async () => {
    const response = await callRoute(
      updatePromptVersionStatus,
      'PATCH',
      { action: 'archive' },
      { params: { promptId: PROMPT_IDS.NP_SELECT_PROP, versionId: 'version-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.promptVersion.update).not.toHaveBeenCalled()
  })

  it('upserts project prompt override using project definition locale scope', async () => {
    const override = {
      id: 'override-1',
      projectId: 'project-1',
      promptDefinitionId: 'definition-1',
      locale: 'zh',
      promptVersionId: 'version-1',
      reason: '项目语气',
      createdByUserId: 'admin-user-1',
    }
    prismaMock.promptVersion.findUnique.mockResolvedValue({
      id: 'version-1',
      promptDefinitionId: 'definition-1',
      locale: 'zh',
    })
    prismaMock.projectPromptOverride.upsert.mockResolvedValue(override)

    const response = await callRoute(
      upsertPromptOverride,
      'PUT',
      {
        promptDefinitionId: 'definition-1',
        promptVersionId: 'version-1',
        locale: 'zh',
        reason: '项目语气',
      },
      { params: { projectId: 'project-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ override })
    expect(prismaMock.promptVersion.findUnique).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      select: { id: true, promptDefinitionId: true, locale: true },
    })
    expect(prismaMock.projectPromptOverride.upsert).toHaveBeenCalledWith({
      where: {
        projectId_promptDefinitionId_locale: {
          projectId: 'project-1',
          promptDefinitionId: 'definition-1',
          locale: 'zh',
        },
      },
      create: {
        projectId: 'project-1',
        promptDefinitionId: 'definition-1',
        locale: 'zh',
        promptVersionId: 'version-1',
        reason: '项目语气',
        createdByUserId: 'admin-user-1',
      },
      update: {
        promptVersionId: 'version-1',
        reason: '项目语气',
        createdByUserId: 'admin-user-1',
      },
    })
  })
})
