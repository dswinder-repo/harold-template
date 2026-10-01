import { NextResponse, type NextRequest } from 'next/server'
import { createClient, isCrmMember } from '@/lib/supabase/server'

// ── Types ──────────────────────────────────────────────────

interface EnrichRequestBody {
  contactId: string
  name: string
  org: string
  category?: string
  missingFields: string[]
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
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
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  if (!(await isCrmMember(supabase))) {
    return NextResponse.json({ success: false, error: 'Not a member of this CRM' }, { status: 403 })
  }

  // 2. Parse request body
  let body: EnrichRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }

  const { contactId, name, org, category, missingFields } = body

  if (!contactId || !name || missingFields.length === 0) {
    return NextResponse.json(
      { success: false, error: 'contactId, name, and missingFields are required' },
      { status: 400 }
    )
  }

  // 3. Call Gemini 2.5 Flash with Google Search grounding
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'AI features are off: set GEMINI_API_KEY to turn them on' }, { status: 500 })
  }

  const fieldDescriptions: Record<string, string> = {
    email: 'Professional email address',
    phone: 'Phone number (with country code)',
    website: 'Organization or personal website URL',
    location: 'City and country (e.g. "Lisbon, Portugal")',
    focus_area: 'Primary professional sector or focus area (brief, 2-5 words)',
  }

  const fieldsPrompt = missingFields
    .map((f) => `- ${f}: ${fieldDescriptions[f] ?? f}`)
    .join('\n')

  const prompt = `You are a data enrichment assistant. Find the following missing information for this contact. Search their organization website, LinkedIn, professional directories, Crunchbase, and any other public sources.

**Contact:** ${name}
**Organization:** ${org || 'Unknown'}
**Type:** ${category ?? 'other'}

**Find these fields:**
${fieldsPrompt}

**Response format — return ONLY valid JSON, no markdown fences:**
[
  { "field": "field_name", "value": "found_value", "confidence": "high|medium|low", "source": "where you found it" }
]

Rules:
- Only include fields where you actually found information.
- For email: prefer professional/work emails over personal.
- For website: prefer the organization's main website.
- confidence "high" = found on official source or multiple sources agree.
- confidence "medium" = found on one source, seems reliable.
- confidence "low" = inferred or uncertain.
- If you find nothing for a field, omit it from the array.
- Return an empty array [] if nothing is found.`

  const model = 'gemini-2.5-flash'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

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
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!geminiRes.ok) {
      if (geminiRes.status === 429) {
        return NextResponse.json(
          { success: false, error: 'Rate limit — please wait', code: 'RATE_LIMIT' },
          { status: 429 }
        )
      }
      return NextResponse.json(
        { success: false, error: 'Gemini API error' },
        { status: 502 }
      )
    }

    const data: GeminiResponse = await geminiRes.json()

    if (data.error) {
      return NextResponse.json(
        { success: false, error: `Gemini error: ${data.error.message}` },
        { status: 502 }
      )
    }

    const content: string = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('')
      .trim()

    if (!content) {
      return NextResponse.json({ success: true, suggestions: [] })
    }

    // Parse JSON — strip markdown fences if Gemini wraps them anyway
    const jsonStr = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let suggestions: { field: string; value: string; confidence: string; source: string }[] = []
    try {
      suggestions = JSON.parse(jsonStr)
      if (!Array.isArray(suggestions)) suggestions = []
    } catch {
      // If JSON parsing fails, return empty
      suggestions = []
    }

    // Map to SuggestedUpdate format
    const allowedFields = new Set(['email', 'phone', 'website', 'location', 'focus_area'])
    const updates = suggestions
      .filter((s) => allowedFields.has(s.field) && s.value)
      .map((s) => ({
        field: s.field,
        currentValue: '',
        suggestedValue: s.value,
        confidence: s.confidence as 'high' | 'medium' | 'low',
        source: s.source || 'AI enrichment',
      }))

    return NextResponse.json({ success: true, suggestions: updates })
  } catch (err) {
    clearTimeout(timeout)

    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'Request timed out' },
        { status: 504 }
      )
    }

    console.error('Enrich error:', err)
    return NextResponse.json(
      { success: false, error: 'Unexpected error during enrichment' },
      { status: 500 }
    )
  }
}
