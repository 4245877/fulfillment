function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return value;
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: numberEnv("PORT", 8080),
  HOST: optional("HOST", "0.0.0.0"),
  DATABASE_URL: required("DATABASE_URL"),
};