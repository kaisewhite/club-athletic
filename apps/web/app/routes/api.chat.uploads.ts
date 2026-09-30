import { handleUploadRequest } from "../../src/lib/chat/upload-http.server";
export function action({ request }: { request: Request }) { return handleUploadRequest(request); }
export function loader({ request }: { request: Request }) { return handleUploadRequest(request); }
