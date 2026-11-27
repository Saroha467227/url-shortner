const el = id => document.getElementById(id);
let currentCode;

async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) {
    const seconds = response.headers.get('Retry-After');
    if (seconds) throw new Error('Rate limit reached. Try again in ' + seconds + ' seconds.');
    throw new Error(body.error || 'The request failed. Please try again.');
  }
  return body;
}

el('create').addEventListener('submit', async event => {
  event.preventDefault();
  el('submit').disabled = true;
  el('message').textContent = 'Creating link…';
  try {
    const link = await request('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: el('destination').value,
        expiresInSeconds: Number(el('expiry').value) || null
      })
    });
    currentCode = link.code;
    el('short-url').href = link.shortUrl;
    el('short-url').textContent = link.shortUrl;
    el('clicks').textContent = '0';
    el('last').textContent = 'No visits yet';
    el('expires').textContent = link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never';
    el('result').hidden = false;
    el('message').textContent = 'Your link is ready.';
  } catch (error) {
    el('message').textContent = error.message;
  } finally {
    el('submit').disabled = false;
  }
});

el('refresh').addEventListener('click', async () => {
  const code = currentCode;
  el('refresh').disabled = true;
  try {
    const stats = await request('/api/links/' + code + '/stats');
    if (currentCode !== code) return;
    el('clicks').textContent = stats.clicks;
    el('last').textContent = stats.lastClickedAt ? new Date(stats.lastClickedAt).toLocaleString() : 'No visits yet';
    if (stats.expired) el('expires').textContent = 'Expired';
    el('message').textContent = 'Stats refreshed. Recorded clicks: ' + stats.clicks + '.';
  } catch (error) {
    if (currentCode === code) el('message').textContent = error.message;
  } finally {
    el('refresh').disabled = false;
  }
});
