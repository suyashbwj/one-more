# Connect the voice companion

The app runs without credentials. The command box works with typing or Wispr Flow dictation. Live conversation requires your own ElevenLabs agent. No voice minutes were consumed during local development.

## Configure the agent

Create a conversational agent in ElevenLabs. Use a supported low-cost LLM and a voice available to your account. Enable agent authentication, since the backend obtains a signed WebSocket URL. Set a short conversation limit in the provider dashboard as well; the app automatically disconnects after 60 seconds, but that client timer is not a billing cap.

Paste this system prompt:

```text
You are One More, a concise, encouraging workout logging companion. Keep responses under two sentences. Do not give medical advice or prescribe workouts.

Call get_workout_context before interpreting a workout request. Use the active session and selected exercise as context. Never invent a workout, set, weight, rep count, or unit. If a request is ambiguous, ask a short clarifying question.

To log or correct a set, call prepare_workout_command with the user's intent expressed using digits. Preserve the user's values and units. Examples: "Bench press 135 lb for 8 reps", "Change set 2 to 7 reps", "Change last set to 60 kg". Use a supported exercise name from context. Do not convert vague speech into a definite value.

The tool only PREPARES a change; it does not save. Read its returned message to the user and ask for confirmation. Only after the user explicitly confirms this exact proposed change, call confirm_workout_command with the returned token. Never make up a token. If the user changes their request, prepare a new proposal and ask again. If the user declines, do not call confirm_workout_command. Confirm a save only when the tool reports success.

For history questions, answer using get_workout_context. It includes up to three recent completed sessions. State when information is unavailable. To delete sets or finish workouts, direct the user to the on-screen controls.
```

First message: `Ready for one more? Tell me your exercise, weight, and reps.`

## Register three client tools

Names must match exactly. Enable **Wait for response** for each tool.

1. `get_workout_context`
   - Description: Read the active workout, selected exercise, preferred unit, and recent completed sessions. Call before interpreting a logging request or answering a history question.
   - No parameters.
2. `prepare_workout_command`
   - Description: Prepare a workout entry or correction. Does not save anything. Returns a confirmation token and a proposed change, or a clarification question.
   - Required string parameter: `text`.
3. `confirm_workout_command`
   - Description: Save the exact pending proposal only after the user explicitly confirms it. Uses the token returned by prepare_workout_command. Repeated or stale tokens do not apply another change.
   - Required string parameter: `token`.

## Local credentials

Fill in the existing `.env` file:

```dotenv
ELEVENLABS_API_KEY=your_private_api_key
ELEVENLABS_AGENT_ID=your_agent_id
PORT=4317
HOST=127.0.0.1
```

Restart with `npm run dev`. The voice card now becomes available. The API key is used only on the server, never exposed in a Vite environment variable, bundle, or API response.

## Live verification checklist

These steps need your account and microphone; they have **not** been tested with a real ElevenLabs connection yet.

- Start a workout, click Talk to One More, and allow microphone access.
- Say "Bench press, 135 pounds for eight reps." Verify a proposal appears.
- Say "Yes." Verify one set appears, with a matching spoken save result.
- Say "Actually, change set one to seven reps." Confirm and verify only that set changes.
- Ask what you did last workout. Check against History.
- End the conversation. Check the provider's usage dashboard for actual consumption.
- Disconnect/reconnect and verify persisted workout context is retrieved again.

The 60-second client cutoff helps conserve minutes. Provider pricing, LLM charges, and quota enforcement still apply. Keep pay-as-you-go disabled if you want to stay within a strict free allowance.

Official references:
- https://elevenlabs.io/docs/eleven-agents/libraries/react
- https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools
- https://elevenlabs.io/docs/eleven-agents/customization/authentication
