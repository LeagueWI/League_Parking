/**
 * Creates ONE dedicated Jotform for League parking email delivery.
 * Run from a terminal with JOTFORM_API_KEY set in its environment.
 * The form's autoresponder must subsequently be enabled in Jotform.
 * Never commit the API key.
 */
const apiKey = process.env.JOTFORM_API_KEY;
if (!apiKey) throw new Error("Set JOTFORM_API_KEY in your terminal environment first.");
const title = "League Parking Weekly Email Dispatcher";
const base = "https://api.jotform.com";
async function request(path, options = {}) {
  const url = new URL(base + path);
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.responseCode >= 400) {
    throw new Error(data.message || "Jotform API error " + response.status);
  }
  return data.content;
}
const existing = await request("/user/forms?limit=100");
let form = existing.find(f => f.title === title);
if (!form) {
  function field(type, text, name, order) {
    return { type, text, name, order: String(order), required: "No" };
  }
  form = await request("/form", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      questions: [
        field("control_email", "Recipient Email", "recipientEmail", 1),
        field("control_textbox", "Reporting Week", "reportingWeek", 2),
        field("control_textbox", "Email Subject", "emailSubject", 3),
        field("control_textarea", "Weekly Summary", "emailMessage", 4)
      ]
    })
  });
  console.log("Created Jotform:", form.id);
} else {
  console.log("Existing Jotform:", form.id);
}
console.log("Form editor: https://www.jotform.com/build/" + form.id);
console.log("Cloudflare secret JOTFORM_FORM_ID:", form.id);
console.log("NEXT: Configure a Jotform autoresponder sent to Recipient Email with Weekly Summary in the email body.");
