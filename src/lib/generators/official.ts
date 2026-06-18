import {
  BaseAudioGenerator,
  BaseImageGenerator,
  BaseVideoGenerator,
  type AudioGenerateParams,
  type GenerateResult,
  type ImageGenerateParams,
  type VideoGenerateParams,
} from './base'
import { generateBailianAudio, generateBailianImage, generateBailianVideo } from '@/lib/providers/bailian'
import { generateSiliconFlowAudio, generateSiliconFlowImage, generateSiliconFlowVideo } from '@/lib/providers/siliconflow'
import { generateStarRouterImage, generateStarRouterVideo } from '@/lib/providers/starrouter'

export class BailianImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'bailian'
    return await generateBailianImage({
      userId: params.userId,
      prompt: params.prompt,
      referenceImages: params.referenceImages,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class SiliconFlowImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'siliconflow'
    return await generateSiliconFlowImage({
      userId: params.userId,
      prompt: params.prompt,
      referenceImages: params.referenceImages,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class StarRouterImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'starrouter'
    return await generateStarRouterImage({
      userId: params.userId,
      prompt: params.prompt,
      referenceImages: params.referenceImages,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class BailianVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'bailian'
    return await generateBailianVideo({
      userId: params.userId,
      imageUrl: params.imageUrl,
      prompt: params.prompt,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class SiliconFlowVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'siliconflow'
    return await generateSiliconFlowVideo({
      userId: params.userId,
      imageUrl: params.imageUrl,
      prompt: params.prompt,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class StarRouterVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'starrouter'
    return await generateStarRouterVideo({
      userId: params.userId,
      imageUrl: params.imageUrl,
      prompt: params.prompt,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class BailianAudioGenerator extends BaseAudioGenerator {
  protected async doGenerate(params: AudioGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'bailian'
    return await generateBailianAudio({
      userId: params.userId,
      text: params.text,
      voice: params.voice,
      rate: params.rate,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}

export class SiliconFlowAudioGenerator extends BaseAudioGenerator {
  protected async doGenerate(params: AudioGenerateParams): Promise<GenerateResult> {
    const modelId = typeof params.options?.modelId === 'string' ? params.options.modelId : ''
    const modelKey = typeof params.options?.modelKey === 'string' ? params.options.modelKey : ''
    const provider = typeof params.options?.provider === 'string' ? params.options.provider : 'siliconflow'
    return await generateSiliconFlowAudio({
      userId: params.userId,
      text: params.text,
      voice: params.voice,
      rate: params.rate,
      options: {
        ...params.options,
        provider,
        modelId,
        modelKey,
      },
    })
  }
}
