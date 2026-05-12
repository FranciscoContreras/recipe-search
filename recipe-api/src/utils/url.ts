export function isSafePublicUrl(rawUrl: string): boolean {
    try {
        const { hostname, protocol } = new URL(rawUrl);
        if (!['http:', 'https:'].includes(protocol)) return false;
        // URL.hostname wraps IPv6 in brackets: "[::1]" — strip them before comparing
        const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return false;
        if (/^127\./.test(h)) return false;
        if (/^10\./.test(h)) return false;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
        if (/^192\.168\./.test(h)) return false;
        if (/^169\.254\./.test(h)) return false;
        return true;
    } catch {
        return false;
    }
}
