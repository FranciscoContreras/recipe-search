// SSRF protection tests for isSafePublicUrl.
// This function guards the /crawl endpoint against Server-Side Request Forgery attacks.

import { isSafePublicUrl } from '../utils/url';

describe('isSafePublicUrl — allowed public URLs', () => {
  it('allows http URLs', () => {
    expect(isSafePublicUrl('http://example.com/recipe')).toBe(true);
  });

  it('allows https URLs', () => {
    expect(isSafePublicUrl('https://www.seriouseats.com/pasta-recipe')).toBe(true);
  });

  it('allows subdomains', () => {
    expect(isSafePublicUrl('https://recipes.nytimes.com/recipe')).toBe(true);
  });

  it('allows public IP addresses (not RFC 1918)', () => {
    expect(isSafePublicUrl('https://8.8.8.8/page')).toBe(true);
    expect(isSafePublicUrl('https://1.1.1.1/page')).toBe(true);
  });
});

describe('isSafePublicUrl — blocked: disallowed protocols', () => {
  it('blocks ftp://', () => {
    expect(isSafePublicUrl('ftp://example.com/file')).toBe(false);
  });

  it('blocks file://', () => {
    expect(isSafePublicUrl('file:///etc/passwd')).toBe(false);
  });

  it('blocks javascript:', () => {
    expect(isSafePublicUrl('javascript:alert(1)')).toBe(false);
  });

  it('blocks data:', () => {
    expect(isSafePublicUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });
});

describe('isSafePublicUrl — blocked: localhost variants', () => {
  it('blocks localhost', () => {
    expect(isSafePublicUrl('http://localhost/admin')).toBe(false);
    expect(isSafePublicUrl('https://localhost:3000/api')).toBe(false);
  });

  it('blocks 0.0.0.0', () => {
    expect(isSafePublicUrl('http://0.0.0.0/api')).toBe(false);
  });

  it('blocks IPv6 loopback ::1', () => {
    expect(isSafePublicUrl('http://[::1]/admin')).toBe(false);
  });
});

describe('isSafePublicUrl — blocked: RFC 1918 private ranges', () => {
  it('blocks 10.0.0.0/8', () => {
    expect(isSafePublicUrl('http://10.0.0.1/api')).toBe(false);
    expect(isSafePublicUrl('http://10.255.255.255/api')).toBe(false);
  });

  it('blocks 172.16.0.0/12', () => {
    expect(isSafePublicUrl('http://172.16.0.1/api')).toBe(false);
    expect(isSafePublicUrl('http://172.20.0.1/api')).toBe(false);
    expect(isSafePublicUrl('http://172.31.255.255/api')).toBe(false);
  });

  it('does NOT block 172.15.x.x or 172.32.x.x (outside the private range)', () => {
    expect(isSafePublicUrl('http://172.15.0.1/page')).toBe(true);
    expect(isSafePublicUrl('http://172.32.0.1/page')).toBe(true);
  });

  it('blocks 192.168.0.0/16', () => {
    expect(isSafePublicUrl('http://192.168.0.1/api')).toBe(false);
    expect(isSafePublicUrl('http://192.168.100.200/api')).toBe(false);
  });
});

describe('isSafePublicUrl — blocked: loopback and link-local', () => {
  it('blocks 127.0.0.1', () => {
    expect(isSafePublicUrl('http://127.0.0.1/api')).toBe(false);
  });

  it('blocks all 127.x.x.x', () => {
    expect(isSafePublicUrl('http://127.1.2.3/api')).toBe(false);
    expect(isSafePublicUrl('http://127.255.255.255/api')).toBe(false);
  });

  it('blocks 169.254.x.x (link-local / AWS metadata endpoint)', () => {
    expect(isSafePublicUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafePublicUrl('http://169.254.0.1/')).toBe(false);
  });
});

describe('isSafePublicUrl — invalid input', () => {
  it('returns false for a plain string that is not a URL', () => {
    expect(isSafePublicUrl('not-a-url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSafePublicUrl('')).toBe(false);
  });

  it('returns false for a bare domain without protocol', () => {
    expect(isSafePublicUrl('example.com/recipe')).toBe(false);
  });
});
