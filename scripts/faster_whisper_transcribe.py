import argparse
import json
import os
import sys

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
