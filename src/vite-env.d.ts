/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_BRIDGE_URL?: string
	readonly VITE_CONNECTION_SERVICE_URL?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}