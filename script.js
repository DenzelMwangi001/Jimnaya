const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  menuButton.textContent = open ? '×' : '☰';
});
document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.textContent = '☰';
}));
document.getElementById('year').textContent = new Date().getFullYear();
const dateInput = document.querySelector('[name="travelDate"]');
if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);
fetch('/api/public-config').then(r => r.json()).then(config => {
  const contact = document.getElementById('footer-contact');
  const contactPanel = document.getElementById('contact-details');
  const items = [];
  if (config.phone) items.push(`<a href="tel:${encodeURIComponent(config.phone)}">${escapeHtml(config.phone)}</a>`);
  if (config.email) items.push(`<a href="mailto:${encodeURIComponent(config.email)}">${escapeHtml(config.email)}</a>`);
  if (config.address) items.push(`<span>${escapeHtml(config.address)}</span>`);
  if (config.hours) items.push(`<span>${escapeHtml(config.hours)}</span>`);
  if (config.whatsapp) items.push(`<a target="_blank" rel="noopener noreferrer" href="https://wa.me/${encodeURIComponent(config.whatsapp)}">Chat on WhatsApp ↗</a>`);
  if (contact) contact.innerHTML = items.join('');
  if (contactPanel) contactPanel.innerHTML = items.join('');
}).catch(() => {});
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
  document.querySelector('[name="service"]').value = link.dataset.service;
}));
document.querySelectorAll('.destination-select').forEach(button => button.addEventListener('click', () => {
  document.querySelector('[name="destination"]').value = button.dataset.destination;
  document.querySelector('#contact').scrollIntoView({behavior:'smooth'});
}));
const form = document.getElementById('enquiry-form');
const status = document.getElementById('form-status');
form.addEventListener('submit', async event => {
  event.preventDefault();
  status.className = 'form-status'; status.textContent = 'Sending your enquiry…';
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/enquiries', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to submit your enquiry.');
    status.textContent = 'Thank you. Your enquiry has been received. Our team will review your request and get back to you.';
    form.reset();
  } catch (error) {
    status.className = 'form-status error';
    status.textContent = error.message || 'The enquiry could not be sent. Please try again.';
  }
});
