import { NextResponse, type NextRequest } from 'next/server'
import { createClient, isCrmMember } from '@/lib/supabase/server'
import { PIPELINE_EMBED, withPipelineSummary } from '@/lib/pipeline'
import {
  buildResearchPrompt,
  parseResearchResponse,
  formatResearchBody,
  type ResearchResult,
} from '@/lib/research'

// ── Types ──────────────────────────────────────────────────

interface ResearchRequestBody {
  contactId: string
  contactName: string
  category: string
}

// ── Gemini response types ──────────────────────────────────

interface GeminiGroundingChunk {
  web?: { uri: string; title: string }
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] }
  groundingMetadata?: {
    webSearchQueries?: string[]
    groundingChunks?: GeminiGroundingChunk[]
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
  let body: ResearchRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body', code: 'UNKNOWN' },
      { status: 400 }
    )
  }

  const { contactId, contactName, category } = body

  if (!contactId || !contactName) {
    return NextResponse.json(
      { success: false, error: 'contactId and contactName are required', code: 'UNKNOWN' },
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

  // 4. Build prompt (Gemini uses a single combined prompt rather than system + user)
  const prompt = buildResearchPrompt(contact, category || 'other')

  // 5. Call Gemini 2.0 Flash with Google Search grounding
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'AI features are off: set GEMINI_API_KEY to turn them on', code: 'API_ERROR' },
      { status: 500 }
    )
  }

  const model = 'gemini-2.5-flash'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 75000) // 75s — better model takes longer

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

    // 6. Parse the Gemini response
    const data: GeminiResponse = await geminiRes.json()

    // Check for API-level errors
    if (data.error) {
      return NextResponse.json(
        { success: false, error: `Gemini error: ${data.error.message}`, code: 'API_ERROR' },
        { status: 502 }
      )
    }

    const candidate = data.candidates?.[0]
    // Gemini often returns multiple text parts — concatenate all of them
    const content: string = (candidate?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('\n\n')
      .trim()
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? []

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Empty response from Gemini', code: 'API_ERROR' },
        { status: 502 }
      )
    }

    // Extract citations from grounding chunks
    const rawCitations = groundingChunks
      .filter((c) => c.web?.uri)
      .map((c) => ({ url: c.web!.uri, title: c.web!.title || 'Source' }))

    const { sections, summary, suggestedUpdates } = parseResearchResponse(content)

    const searchedAt = new Date().toISOString()
    const researchResult: ResearchResult = {
      summary,
      sections,
      suggestedUpdates,
      citations: rawCitations,
      model: data.modelVersion ?? model,
      searchedAt,
    }

    // 7. Auto-log as an interaction note
    const interactionBody = formatResearchBody(researchResult, contactName)

    const { data: interaction, error: interactionError } = await supabase
      .from('interactions')
      .insert({
        contact_id: contactId,
        type: 'note',
        subject: `AI Research: ${contactName}`,
        body: interactionBody,
        occurred_at: searchedAt,
        user_id: user.id,
      })
      .select('id')
      .single()

    if (interactionError) {
      console.error('Failed to log research interaction:', interactionError.message)
    }

    // 8. Return structured response
    return NextResponse.json({
      success: true,
      research: researchResult,
      interactionId: interaction?.id ?? null,
    })
  } catch (err) {
    clearTimeout(timeout)

    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'Research request timed out (75s)', code: 'API_ERROR' },
        { status: 504 }
      )
    }

    console.error('Research error:', err)
    return NextResponse.json(
      { success: false, error: 'Unexpected error during research', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
