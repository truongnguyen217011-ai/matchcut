import argparse
import json
import os
import sys

# NVIDIA's Windows wheels keep the CUDA DLLs inside site-packages. Register
# those folders before importing CTranslate2/Faster-Whisper.
_dll_handles = []
if os.name == "nt":
    site_packages = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    site_packages = os.path.join(site_packages, ".venv-whisper", "Lib", "site-packages")
    cuda_bins = [
        os.path.join(site_packages, "nvidia", "cublas", "bin"),
        os.path.join(site_packages, "nvidia", "cudnn", "bin"),
    ]
    for cuda_bin in cuda_bins:
        if os.path.isdir(cuda_bin):
            _dll_handles.append(os.add_dll_directory(cuda_bin))
    os.environ["PATH"] = os.pathsep.join(cuda_bins + [os.environ.get("PATH", "")])

from faster_whisper import WhisperModel


def transcribe(audio_path, language, model_name, device, compute_type):
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        audio_path,
        language=None if language == "auto" else language,
        beam_size=1,
        best_of=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
        condition_on_previous_text=False,
        word_timestamps=False,
    )
    chunks = []
    texts = []
    for segment in segments:
        text = segment.text.strip()
        if text and segment.end > segment.start:
            texts.append(text)
            chunks.append({"text": text, "start": round(segment.start, 3), "end": round(segment.end, 3)})
    return {
        "language": info.language,
        "languageProbability": round(info.language_probability, 4),
        "audioDuration": round(info.duration, 3),
        "text": " ".join(texts),
        "chunks": chunks,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model", default=os.environ.get("MATCHCUT_WHISPER_MODEL", "small"))
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    args = parser.parse_args()

    attempts = [("cuda", "float16"), ("cpu", "int8")] if args.device == "auto" else [
        (args.device, "float16" if args.device == "cuda" else "int8")
    ]
    errors = []
    for device, compute_type in attempts:
        try:
            result = transcribe(args.audio, args.language, args.model, device, compute_type)
            result.update({"engine": "faster-whisper", "device": device, "model": args.model, "audioParts": 1})
            print(json.dumps(result, ensure_ascii=False))
            return
        except Exception as error:
            errors.append(f"{device}: {error}")

    print(json.dumps({"error": " | ".join(errors)}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
