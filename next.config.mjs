import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

/**
 * Undefined entries are not supported. Push optional patterns to this array only if defined.
 * @type {import('next/dist/shared/lib/image-config').RemotePattern}
 */
const remotePatterns = []

// S3 Storage
if (process.env.S3_UPLOAD_ENDPOINT) {
  // custom endpoint for providers other than AWS
  const url = new URL(process.env.S3_UPLOAD_ENDPOINT)
  remotePatterns.push({
    hostname: url.hostname,
  })
} else if (process.env.S3_UPLOAD_BUCKET && process.env.S3_UPLOAD_REGION) {
  // default provider
  remotePatterns.push({
    hostname: `${process.env.S3_UPLOAD_BUCKET}.s3.${process.env.S3_UPLOAD_REGION}.amazonaws.com`,
  })
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server (.next/standalone) with only the traced
  // production files, so the runtime image stays small.
  output: 'standalone',
  // Enable the React Compiler for automatic memoization (stable in Next.js 16).
  // Requires the babel-plugin-react-compiler dev dependency.
  reactCompiler: true,
  images: {
    remotePatterns,
  },
  // Required to run in a codespace (see https://github.com/vercel/next.js/issues/58019)
  experimental: {
    serverActions: {
      // Allow server actions from the configured base URL and localhost.
      // BASE_URL (runtime) takes precedence over NEXT_PUBLIC_BASE_URL (build-time);
      // localhost:3000 covers local dev and same-host access.
      allowedOrigins: (() => {
        const base = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL
        return ['localhost:3000', ...(base ? [new URL(base).host] : [])]
      })(),
    },
  },
}

export default withNextIntl(nextConfig)
