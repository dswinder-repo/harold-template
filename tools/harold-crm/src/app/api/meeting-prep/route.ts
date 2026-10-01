import { NextResponse, type NextRequest } from 'next/server'
import { createClient, isCrmMember } from '@/lib/supabase/server'
import { SENDER_PROFILE_KEY, senderProfileAsPrompt, type SenderProfile } from '@/lib/senderProfile'
import { PIPELINE_EMBED, withPipelineSummary } from '@/lib/pipeline'
import {
  buildPrepPrompt,
  parsePrepResponse,
  formatPrepBody,
  type PrepResult,
} from '@/lib/meetingPrep'

// ── Types ──────────────────────────────────────────────────

interface PrepRequestBody {
  contactId: string
}

// ── Gemini response types ──────────────────────────────────

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] }
  groundingMetadata?: {
    webSearchQueries?: string[]
    groundingChunks?: { web?: { uri: string; title: string } }[]
  }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  modelVersion?: string
  error?: { message: string; code: number }
}

// ── Handler ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated', code: 'AUTH_ERROR' },
      { status: 401 }
    )
  }

  if (!(await isCrmMember(supabase))) {
    return NextResponse.json(
      { success: false, error: 'Not a member of this CRM', code: 'AUTH_ERROR' },
      { status: 403 }
    )
  }

  // 2. Parse request body
  let body: PrepRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body', code: 'UNKNOWN' },
      { status: 400 }
    )
  }

  const { contactId } = body

  if (!contactId) {
    return NextResponse.json(
      { success: false, error: 'contactId is required', code: 'UNKNOWN' },
      { status: 400 }
    )
  }

  // 3. Fetch the full contact record
  const { data: contactRow, error: contactError } = await supabase
    .from('contacts')
    .select(`*, ${PIPELINE_EMBED}`)
    .eq('id', contactId)
    .single()
  const contact = contactRow ? withPipelineSummary(contactRow) : null

  if (contactError || !contact) {
    return NextResponse.json(
      { success: false, error: 'Contact not found', code: 'CONTACT_NOT_FOUND' },
      { status: 404 }
    )
  }

  // 4. The contact's type decides which talking-point guidance applies
  const primaryCategory = (contact.category as string) || 'other'

  // 5. Fetch last 20 interactions (most recent first)
  const { data: interactions } = await supabase
    .from('interactions')
    .select('type, subject, body, occurred_at')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(20)

  const interactionData = (interactions ?? []).map((i: Record<string, unknown>) => ({
    type: (i.type as string) ?? '',
    subject: (i.subject as string) ?? '',
    body: (i.body as string) ?? undefined,
    occurred_at: (i.occurred_at as string) ?? '',
  }))

  // 6. Fetch open tasks for this contact
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, status, priority, due_date')
    .eq('contact_id', contactId)
    .neq('status', 'completed')
    .order('due_date', { ascending: true })

  const taskData = (tasks ?? []).map((t: Record<string, unknown>) => ({
    title: (t.title as string) ?? '',
    status: (t.status as string) ?? '',
    priority: (t.priority as string) ?? 'medium',
    due_date: (t.due_date as string) ?? undefined,
  }))

  // 7. Load the sender profile, then build the prompt.
  // Who "we" are is configuration (Settings > Sender Profile), not a constant in the
  // app. Absent, the brief reasons from the contact alone instead of assuming a company.
  const { data: senderSetting } = await supabase
    .from('crm_settings')
    .select('value')
    .eq('key', SENDER_PROFILE_KEY)
    .maybeSingle()
  const senderProfile = senderProfileAsPrompt(senderSetting?.value as SenderProfile | null)

  const prompt = buildPrepPrompt(contact, primaryCategory, interactionData, taskData, senderProfile)

  // 8. Call Gemini 2.5 Flash with Google Search grounding
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'AI features are off: set GEMINI_API_KEY to turn on meeting prep', code: 'API_ERROR' },
      { status: 500 }
    )
  }

  const model = 'gemini-2.5-flash'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 75000)

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!geminiRes.ok) {
      if (geminiRes.status === 429) {
        return NextResponse.json(
          { success: false, error: 'Rate limit exceeded. Please wait a moment.', code: 'RATE_LIMIT' },
          { status: 429 }
        )
      }
      const errText = await geminiRes.text().catch(() => 'Unknown error')
      return NextResponse.json(
        { success: false, error: `Gemini API error: ${errText}`, code: 'API_ERROR' },
        { status: 502 }
      )
    }

    // 9. Parse the Gemini response
    const data: GeminiResponse = await geminiRes.json()

    if (data.error) {
      return NextResponse.json(
        { success: false, error: `Gemini error: ${data.error.message}`, code: 'API_ERROR' },
        { status: 502 }
      )
    }

    const candidate = data.candidates?.[0]
    const content: string = (candidate?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('\n\n')
      .trim()

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Empty response from Gemini', code: 'API_ERROR' },
        { status: 502 }
      )
    }

    const { sections, summary } = parsePrepResponse(content)

    const preparedAt = new Date().toISOString()
    const prepResult: PrepResult = {
      summary,
      sections,
      model: data.modelVersion ?? model,
      preparedAt,
    }

    // 10. Auto-log as an interaction note
    const interactionBody = formatPrepBody(prepResult, contact.name as string)

    const { data: interaction, error: interactionError } = await supabase
      .from('interactions')
      .insert({
        contact_id: contactId,
        type: 'note',
        subject: `Meeting Prep: ${contact.name}`,
        body: interactionBody,
        occurred_at: preparedAt,
        user_id: user.id,
      })
      .select('id')
      .single()

    if (interactionError) {
      console.error('Failed to log prep interaction:', interactionError.message)
    }

    // 11. Return structured response
    return NextResponse.json({
      success: true,
      prep: prepResult,
      interactionId: interaction?.id ?? null,
    })
  } catch (err) {
    clearTimeout(timeout)

    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'Meeting prep request timed out (75s)', code: 'API_ERROR' },
        { status: 504 }
      )
    }

    console.error('Meeting prep error:', err)
    return NextResponse.json(
      { success: false, error: 'Unexpected error during meeting prep', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
