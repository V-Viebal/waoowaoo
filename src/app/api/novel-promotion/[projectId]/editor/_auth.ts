import { prisma } from '@/lib/prisma'
import { getAuthSession, notFound, unauthorized } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'

/**
 * Guarantees the caller is authed and owns the project.
 * Returns either an error NextResponse (call isErrorResponse to check) or { session, project }.
 * ponytail: single source of truth — was copy-pasted across 4 editor routes.
 */
export async function requireOwnedProject(projectId: string) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return unauthorized()
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: session.user.id,
    },
    select: {
      id: true,
      userId: true,
      name: true,
    },
  })

  if (!project) {
    return notFound('Project')
  }

  return { session, project }
}

export async function requireOwnedEditorProject(params: {
  projectId: string
  episodeId: string
  editorProjectId: string
}) {
  const editorProject = await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: params.editorProjectId,
      episodeId: params.episodeId,
      episode: {
        novelPromotionProject: {
          projectId: params.projectId,
        },
      },
    },
    select: {
      id: true,
      episodeId: true,
      projectData: true,
    },
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND')
  }

  return editorProject
}
