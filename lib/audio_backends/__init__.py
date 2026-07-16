"""语音合成（TTS）服务层公共 API。"""

from lib.audio_backends.base import (
    AudioBackend,
    AudioCapability,
    AudioSynthesisRequest,
    AudioSynthesisResult,
)
from lib.audio_backends.registry import create_backend, get_registered_backends, register_backend

__all__ = [
    "AudioBackend",
    "AudioCapability",
    "AudioSynthesisRequest",
    "AudioSynthesisResult",
    "create_backend",
    "get_registered_backends",
    "register_backend",
]

# Backend auto-registration
from lib.audio_backends.dashscope import DashScopeAudioBackend
from lib.providers import PROVIDER_DASHSCOPE

register_backend(PROVIDER_DASHSCOPE, DashScopeAudioBackend)

from lib.audio_backends.llm360_elevenlabs import Llm360ElevenLabsAudioBackend
from lib.providers import PROVIDER_ELEVENLABS

register_backend(PROVIDER_ELEVENLABS, Llm360ElevenLabsAudioBackend)
