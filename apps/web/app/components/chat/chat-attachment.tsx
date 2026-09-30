import { useEffect, useState, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { UPLOAD_ACCEPT, UPLOAD_ERRORS, UPLOAD_FILE_BYTES, publicAttachment } from "@/lib/chat/upload-policy";
import "./chat-attachment.css";

export function AttachmentLabel({ value }: { value: unknown }) {
  const attachment = publicAttachment(value);
  return attachment ? <span className="chat-attachment-label">{attachment.filename}</span> : null;
}
export function ChatAttachment({ file, disabled, onChange, children }: {
  file: File | null; disabled: boolean; onChange: (file: File | null) => void;
  children: (control: ReactNode) => ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file?.type.startsWith("image/")) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => { URL.revokeObjectURL(url); };
  }, [file]);
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    accept: UPLOAD_ACCEPT, multiple: false, maxFiles: 1, maxSize: UPLOAD_FILE_BYTES, minSize: 1,
    noClick: true, noKeyboard: true, disabled,
    // v20.1.2's root onPaste routes clipboard files through the same validator
    // and onDrop as the picker/drop. Plain-text pastes remain untouched.
    noPaste: false,
    onDrop: (accepted: File[], rejected: readonly { errors: readonly { code: string }[] }[]) => {
      if (disabled) return;
      if (rejected.length || accepted.length !== 1) {
        setError(rejected.some(item => item.errors.some(error => error.code === "file-too-large")) ? UPLOAD_ERRORS.size : UPLOAD_ERRORS.invalid); return;
      }
      setError(null); onChange(accepted[0]!);
    },
    onError: () => setError(UPLOAD_ERRORS.failed),
  });
  // react-dropzone stamps `aria-disabled` on its ROOT when the dropzone is disabled,
  // and this root wraps the whole composer. While a turn is running the dropzone is
  // disabled and the Stop button is showing, so that attribute marked Stop — and the
  // textarea — as disabled to assistive technology and to anything that honours it,
  // even though both are live. The picker, chip and remove controls carry their own
  // `disabled`, so the container must not claim it.
  const rootProps = getRootProps({ className: `chat-attachment-area${isDragActive ? " is-dragging" : ""}` }) as Record<string, unknown>;
  delete rootProps["aria-disabled"];
  return <div {...rootProps}>
    <input {...getInputProps({ "aria-label": "Choose an image or PDF attachment" })} />
    {file && <div className="chat-attachment-chip">
      {preview && <img src={preview} alt="Selected attachment preview" />}
      <span>{file.type === "application/pdf" ? "attachment.pdf" : "Image attachment"}</span>
      <button type="button" disabled={disabled} onClick={() => { setError(null); onChange(null); }} aria-label="Remove attachment">×</button>
    </div>}
    {error && <p role="alert" className="chat-notice">{error}</p>}
    {isDragActive && <p role="status" className="chat-notice">Drop one image or PDF here</p>}
    {children(<button type="button" className="chat-attach" disabled={disabled} onClick={open} aria-label="Attach an image or PDF">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9a2 2 0 0 1 3 3l-8 8a1 1 0 0 1-2-2l7-7" /></svg>
    </button>)}
  </div>;
}
