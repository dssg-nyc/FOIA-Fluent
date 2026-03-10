"""Convert uploaded files into Claude API content blocks.

Supported formats:
  PDF         → {"type": "document", "source": {"type": "base64", ...}}
  PNG/JPEG/   → {"type": "image",    "source": {"type": "base64", ...}}
  WebP/GIF
  TIFF        → converted to PNG via Pillow, then image block
  DOCX        → text extracted with python-docx, returned as text block
  TXT / HTML  → read as plain text, returned as text block
"""
import base64
import io
import logging

logger = logging.getLogger(__name__)

PDF_MEDIA_TYPE = "application/pdf"
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
TIFF_TYPES = {"image/tiff", "image/tiff-fx"}
DOCX_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
TEXT_TYPES = {"text/plain", "text/html"}


def _to_base64(data: bytes) -> str:
    return base64.standard_b64encode(data).decode("utf-8")


async def process_attachment(filename: str, content: bytes, media_type: str) -> dict:
    """Return a Claude API content block for the given file.

    Falls back to a plain-text block with an error note if the file cannot
    be processed, so the rest of the analysis still proceeds.
    """
    media_type = (media_type or "").lower().split(";")[0].strip()

    try:
        # PDF ----------------------------------------------------------------
        if media_type == PDF_MEDIA_TYPE or filename.lower().endswith(".pdf"):
            return {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": _to_base64(content),
                },
            }

        # Standard images ----------------------------------------------------
        if media_type in IMAGE_TYPES or any(
            filename.lower().endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".webp", ".gif")
        ):
            # Normalise media_type
            if filename.lower().endswith(".jpg") or filename.lower().endswith(".jpeg"):
                media_type = "image/jpeg"
            elif filename.lower().endswith(".png"):
                media_type = "image/png"
            elif filename.lower().endswith(".webp"):
                media_type = "image/webp"
            elif filename.lower().endswith(".gif"):
                media_type = "image/gif"
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": _to_base64(content),
                },
            }

        # TIFF → PNG ---------------------------------------------------------
        if media_type in TIFF_TYPES or filename.lower().endswith((".tif", ".tiff")):
            try:
                from PIL import Image  # type: ignore
                img = Image.open(io.BytesIO(content))
                buf = io.BytesIO()
                img.convert("RGB").save(buf, format="PNG")
                return {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": _to_base64(buf.getvalue()),
                    },
                }
            except ImportError:
                logger.warning("Pillow not installed — cannot convert TIFF; falling back to text")
            except Exception as e:
                logger.warning("TIFF conversion failed (%s): %s", filename, e)

        # DOCX ---------------------------------------------------------------
        if media_type in DOCX_TYPES or filename.lower().endswith((".docx", ".doc")):
            try:
                from docx import Document  # type: ignore
                doc = Document(io.BytesIO(content))
                text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
                return {"type": "text", "text": f"[Document: {filename}]\n{text}"}
            except ImportError:
                logger.warning("python-docx not installed — cannot extract DOCX text; falling back")
            except Exception as e:
                logger.warning("DOCX extraction failed (%s): %s", filename, e)

        # Plain text / HTML --------------------------------------------------
        if media_type in TEXT_TYPES or filename.lower().endswith((".txt", ".html", ".htm")):
            text = content.decode("utf-8", errors="replace")
            return {"type": "text", "text": f"[Document: {filename}]\n{text}"}

        # Fallback: try UTF-8, give up gracefully ----------------------------
        try:
            text = content.decode("utf-8", errors="replace")
            return {"type": "text", "text": f"[Document: {filename}]\n{text}"}
        except Exception:
            return {"type": "text", "text": f"[Attachment: {filename} — could not be processed]"}

    except Exception as e:
        logger.error("Unexpected error processing attachment %s: %s", filename, e)
        return {"type": "text", "text": f"[Attachment: {filename} — processing error: {e}]"}
