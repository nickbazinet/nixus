export interface ApiError {
  error: {
    type: "validation" | "auth" | "not_found" | "payment" | "internal";
    message: string;
    field?: string;
  };
}
