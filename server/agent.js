"use strict";

const fs = require("fs");
const path = require("path");

const REQUESTS_PATH = path.join(__dirname, "../data/requests.json");
const BOOKINGS_PATH = path.join(__dirname, "../data/bookings.csv");
const MAX_STEPS = 5;

/**
 * Read bookings.csv and return the row whose email matches, or {found:false}.
 * The e-mail comes from the form; the model never supplies it.
 */
function lookupBooking(email) {
  const raw = fs.readFileSync(BOOKINGS_PATH, "utf8");
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",");
  const emailIndex = headers.indexOf("email");

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values[emailIndex] && values[emailIndex].trim() === email.trim()) {
      const row = {};
      headers.forEach((h, idx) => { row[h.trim()] = values[idx] ? values[idx].trim() : ""; });
      return row;
    }
  }
  return { found: false };
}

// Tool definitions sent to the model
const TOOLS = [
  {
    name: "log_request",
    description:
      "Records the request in the hotel's log. Call it exactly once per guest message, before your final answer.",
    input_schema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: [
            "Reservations",
            "Billing & Payments",
            "Front Desk & Guest Services",
            "Housekeeping & Maintenance",
            "Restaurant & Events",
            "Complaints & Feedback",
          ],
        },
        urgency: {
          type: "string",
          enum: ["high", "normal"],
        },
        summary: {
          type: "string",
        },
        status: {
          type: "string",
          enum: ["ANSWERED", "ESCALATED"],
        },
      },
      required: ["department", "urgency", "summary", "status"],
    },
  },
  {
    name: "lookup_booking",
    description:
      "Returns the guest's own reservation: dates, room type, breakfast, rate and payment status, or that no booking was found. Use it only when the answer depends on the guest's booking.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

/**
 * Run the agent loop for one guest message.
 *
 * @param {object} anthropicClient  - Configured @anthropic-ai/sdk client
 * @param {string} systemPrompt     - Full system prompt (base + policies)
 * @param {string} name             - Guest name from the form
 * @param {string} email            - Guest e-mail from the form
 * @param {string} message          - Guest message from the form
 * @returns {Promise<string>}       - Model's final text reply
 */
async function runAgent(anthropicClient, systemPrompt, name, email, message) {
  const messages = [
    {
      role: "user",
      content: `Guest name: ${name}\nGuest email: ${email}\n\nMessage:\n${message}`,
    },
  ];

  let logFields = null;   // set when log_request is called
  let logCalled = false;  // guard against duplicate calls
  let finalText = null;
  const trace = [];       // one entry per event

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await anthropicClient.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    const askedForTool = response.stop_reason === "tool_use";
    trace.push({
      event: "model_call",
      step,
      stop_reason: response.stop_reason,
      tool_use: askedForTool,
    });

    // Append the assistant turn (may contain text and/or tool_use blocks)
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      // Model finished — extract the last text block
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock) {
        finalText = textBlock.text;
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      // Process every tool_use block in this turn
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        let result;
        if (block.name === "log_request") {
          if (logCalled) {
            result = "already logged";
          } else {
            logCalled = true;
            logFields = block.input; // { department, urgency, summary, status }
            result = { ok: true };
          }
        } else if (block.name === "lookup_booking") {
          result = lookupBooking(email);
        } else {
          result = { error: "Unknown tool." };
        }

        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        trace.push({
          event: "tool_call",
          name: block.name,
          arguments: block.input,
          result: resultStr.slice(0, 200),
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultStr,
        });
      }

      // Also capture any text block that arrived alongside tool_use
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock) {
        finalText = textBlock.text;
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Any other stop_reason — break and use whatever text we have
    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock) finalText = textBlock.text;
    break;
  }

  trace.push({ event: "final_answer", text: finalText || "" });

  // Save one row to data/requests.json regardless of whether log_request was called
  const row = {
    time: new Date().toISOString(),
    name,
    email,
    message,
    department: logFields ? logFields.department : "",
    urgency:    logFields ? logFields.urgency    : "",
    summary:    logFields ? logFields.summary    : "",
    status:     logFields ? logFields.status     : "ESCALATED",
    reply:      finalText || "",
    ...(logFields ? {} : { note: "no log_request call" }),
    trace,
  };

  const existing = JSON.parse(fs.readFileSync(REQUESTS_PATH, "utf8"));
  existing.push(row);
  fs.writeFileSync(REQUESTS_PATH, JSON.stringify(existing, null, 2));

  return finalText || "A member of staff will reply to you by e-mail.";
}

module.exports = { runAgent };
