import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ArtStyleEditor } from '@/app/[locale]/profile/components/art-style-library/ArtStyleEditor'

// Mock apiFetch
const mockApiFetch = vi.fn()
vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (url: string, options?: RequestInit) => mockApiFetch(url, options),
}))

// Mock model list response
const mockModelsResponse = {
  llm: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  ],
  image: [
    { value: 'dall-e-3', label: 'DALL-E 3' },
    { value: 'stable-diffusion-xl', label: 'Stable Diffusion XL' },
  ],
}

const mockLabels = {
  name: '名称',
  description: '描述',
  prompt: '提示词',
  previewImageUrl: '预览图 URL',
  sortOrder: '排序',
  save: '保存',
  cancel: '取消',
  generate: 'AI 生成提示词',
  generating: '生成中...',
  selectModel: '选择模型',
  generatePreview: '生成预览图',
  generatingPreview: '生成预览图中...',
  selectImageModel: '选择图片模型',
}

describe('ArtStyleEditor Component', () => {
  const mockOnSubmit = vi.fn()
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render all form fields correctly', () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      expect(screen.getByLabelText(mockLabels.name)).toBeInTheDocument()
      expect(screen.getByLabelText(mockLabels.description)).toBeInTheDocument()
      expect(screen.getByLabelText(mockLabels.prompt)).toBeInTheDocument()
      expect(screen.getByLabelText(mockLabels.previewImageUrl)).toBeInTheDocument()
      expect(screen.getByLabelText(mockLabels.sortOrder)).toBeInTheDocument()
    })

    it('should render action buttons', () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      expect(screen.getByRole('button', { name: mockLabels.save })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: mockLabels.cancel })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: mockLabels.generate })).toBeInTheDocument()
    })

    it('should render model selectors', async () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      // Should have two selectors (LLM and Image)
      const selects = await screen.findAllByRole('combobox')
      expect(selects.length).toBe(2)
    })

    it('should display initial values when provided', () => {
      const initialValues = {
        name: '赛博朋克风',
        description: '未来科技风格，霓虹灯光效果',
        prompt: 'cyberpunk style, neon lights, futuristic city',
        previewImageUrl: 'https://example.com/preview.jpg',
        sortOrder: 100,
      }

      render(
        <ArtStyleEditor
          initialValues={initialValues}
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      expect(screen.getByLabelText(mockLabels.name)).toHaveValue(initialValues.name)
      expect(screen.getByLabelText(mockLabels.description)).toHaveValue(initialValues.description)
      expect(screen.getByLabelText(mockLabels.prompt)).toHaveValue(initialValues.prompt)
      expect(screen.getByLabelText(mockLabels.previewImageUrl)).toHaveValue(initialValues.previewImageUrl)
      expect(screen.getByLabelText(mockLabels.sortOrder)).toHaveValue(initialValues.sortOrder)
    })
  })

  describe('Form Interactions', () => {
    it('should update input values when user types', () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      const nameInput = screen.getByLabelText(mockLabels.name)
      fireEvent.change(nameInput, { target: { value: '像素艺术' } })
      expect(nameInput).toHaveValue('像素艺术')

      const promptInput = screen.getByLabelText(mockLabels.prompt)
      fireEvent.change(promptInput, { target: { value: 'pixel art style, 8-bit, retro gaming aesthetics' } })
      expect(promptInput).toHaveValue('pixel art style, 8-bit, retro gaming aesthetics')
    })

    it('should call onCancel when cancel button is clicked', () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: mockLabels.cancel }))
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit with trimmed values when form is submitted', async () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      fireEvent.change(screen.getByLabelText(mockLabels.name), { target: { value: '  水彩风格  ' } })
      fireEvent.change(screen.getByLabelText(mockLabels.description), { target: { value: '  手绘水彩质感  ' } })
      fireEvent.change(screen.getByLabelText(mockLabels.prompt), { target: { value: '  watercolor painting style  ' } })

      fireEvent.submit(screen.getByRole('form'))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            name: '水彩风格',
            description: '手绘水彩质感',
            prompt: 'watercolor painting style',
          }),
        )
      })
    })

    it('should disable buttons when saving', () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={true}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      expect(screen.getByRole('button', { name: mockLabels.save })).toBeDisabled()
    })
  })

  describe('AI Generation Feature', () => {
    beforeEach(() => {
      // Mock model list API
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockModelsResponse,
      })
    })

    it('should disable generate button when name is empty', async () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        const generateButtons = screen.getAllByRole('button', { name: mockLabels.generate })
        expect(generateButtons[0]).toBeDisabled()
      })
    })

    it('should enable generate button when name is provided', async () => {
      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        fireEvent.change(screen.getByLabelText(mockLabels.name), { target: { value: '赛博朋克' } })
        const generateButtons = screen.getAllByRole('button', { name: mockLabels.generate })
        expect(generateButtons[0]).not.toBeDisabled()
      })
    })

    it('should call generation API when generate button is clicked', async () => {
      const mockPromptResponse = {
        prompt: 'cyberpunk style, neon lights, futuristic city, high contrast, dramatic lighting',
        description: '赛博朋克风格，霓虹灯光效果，未来都市感',
      }

      // First call: models, second call: generate
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockModelsResponse,
      })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPromptResponse,
      })

      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        fireEvent.change(screen.getByLabelText(mockLabels.name), { target: { value: '赛博朋克' } })
        fireEvent.change(screen.getByLabelText(mockLabels.description), { target: { value: '未来科技感' } })
      })

      // Click generate button
      const generateButtons = screen.getAllByRole('button', { name: mockLabels.generate })
      fireEvent.click(generateButtons[0])

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/api/art-styles/generate-prompt',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"name":"赛博朋克"'),
          }),
        )
      })

      await waitFor(() => {
        expect(screen.getByLabelText(mockLabels.prompt)).toHaveValue(mockPromptResponse.prompt)
      })
    })

    it('should show loading state during generation', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockModelsResponse,
      })
      mockApiFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({ prompt: 'test prompt', description: 'test desc' }),
              })
            }, 100)
          }),
      )

      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        fireEvent.change(screen.getByLabelText(mockLabels.name), { target: { value: '测试画风' } })
      })

      const generateButtons = screen.getAllByRole('button', { name: mockLabels.generate })
      fireEvent.click(generateButtons[0])

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: mockLabels.generating })[0]).toBeInTheDocument()
      })
    })

    it('should display error message when generation fails', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockModelsResponse,
      })
      mockApiFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'API 请求失败' }),
      })

      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        fireEvent.change(screen.getByLabelText(mockLabels.name), { target: { value: '测试画风' } })
      })

      const generateButtons = screen.getAllByRole('button', { name: mockLabels.generate })
      fireEvent.click(generateButtons[0])

      await waitFor(() => {
        expect(screen.getByText('API 请求失败')).toBeInTheDocument()
      })
    })

    it('should handle network errors gracefully', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockModelsResponse,
      })
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

      render(
        <ArtStyleEditor
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        fireEvent.change(screen.getByLabelText(mockLabels.name), { target: { value: '测试画风' } })
      })

      const generateButtons = screen.getAllByRole('button', { name: mockLabels.generate })
      fireEvent.click(generateButtons[0])

      await waitFor(() => {
        expect(screen.getByText('生成失败，请重试')).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should reset values when initialValues changes', async () => {
      const { rerender } = render(
        <ArtStyleEditor
          initialValues={{ name: '初始画风' }}
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      expect(screen.getByLabelText(mockLabels.name)).toHaveValue('初始画风')

      rerender(
        <ArtStyleEditor
          initialValues={{ name: '新画风' }}
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      await waitFor(() => {
        expect(screen.getByLabelText(mockLabels.name)).toHaveValue('新画风')
      })
    })

    it('should handle sortOrder as 0', () => {
      render(
        <ArtStyleEditor
          initialValues={{ sortOrder: 0 }}
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      expect(screen.getByLabelText(mockLabels.sortOrder)).toHaveValue(0)
    })

    it('should default sortOrder to 0 when invalid value is provided', async () => {
      render(
        <ArtStyleEditor
          initialValues={{ sortOrder: NaN }}
          labels={mockLabels}
          saving={false}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />,
      )

      fireEvent.submit(screen.getByRole('form'))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ sortOrder: 0 }),
        )
      })
    })
  })
})
