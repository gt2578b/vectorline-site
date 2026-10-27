async function call(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) throw new Error((isJson && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  meta: () => call('GET', '/api/meta'),
  profiles: () => call('GET', '/api/profiles'),
  saveProfile: (id, p) => call('PUT', `/api/profiles/${id}`, p),
  deleteProfile: (id) => call('DELETE', `/api/profiles/${id}`),
  certs: () => call('GET', '/api/certs'),
  createCerts: (body) => call('POST', '/api/certs', body),
  deleteCerts: (id) => call('DELETE', `/api/certs/${id}`),
  sign: (form) => call('POST', '/api/sign', form),
  verify: (form) => call('POST', '/api/verify', form),
  sample: async () => new File([await call('GET', '/api/sample.jpg')], 'sample.jpg', { type: 'image/jpeg' }),
  blob: (url) => call('GET', url),
};
