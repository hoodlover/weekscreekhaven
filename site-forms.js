document.querySelectorAll('form[data-site-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const originalLabel = button?.textContent || 'Send';
    let status = form.querySelector('[data-form-status]');
    if (!status) {
      status = document.createElement('p');
      status.dataset.formStatus = '';
      status.setAttribute('role', 'status');
      status.style.cssText = 'margin-top:12px;text-align:center;font-weight:700;';
      form.appendChild(status);
    }
    status.textContent = '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending...';
    }
    try {
      let operation = form.querySelector('input[name="operation_id"]');
      if (!operation) {
        operation = document.createElement('input');
        operation.type = 'hidden';
        operation.name = 'operation_id';
        form.appendChild(operation);
      }
      if (!operation.value) operation.value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const payload = {};
      new FormData(form).forEach((value, key) => {
        if (payload[key]) payload[key] = [].concat(payload[key], value);
        else payload[key] = value;
      });
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The message could not be sent.');
      window.location.href = form.dataset.success || '/thank-you.html';
    } catch (error) {
      status.textContent = `${error.message} Your answers are still here; please try again.`;
      status.style.color = '#9f2f2f';
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  });
});
