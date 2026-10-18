import { noInsights, renderCompletedJob, openStudioTool, stubDesktopLayout, gappedTranscript, renderGappedTranscriptOnDesktop, searchbox, renderedMediaElement, playTo, currentSegmentText, multiSpeakerTranscript, soloTranscript } from '@/test/job-detail-page-support'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { speakerSuggestionsApi, transcriptApi, speakerInsightsApi } from '@/lib/api'
import type { SpeakerInsights, Transcript } from '@/types/api'

describe('JobDetailPage speakers (COMPLETED, desktop layout)', () => {
  const segmentRow = (text: string) => screen.getByText(text).closest('[data-segment-index]') as HTMLElement

  it('folds a big meeting\'s speakers into their heading, and opens them on request', async () => {
    stubDesktopLayout()
    const user = userEvent.setup()
    const labels = ['S1', 'S2', 'S3', 'S4', 'S5']
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: labels.map((label, i) => ({ id: `seg-${i}`, startTime: i * 2, endTime: i * 2 + 2, speakerLabel: label, text: `第 ${i} 句`, originalText: `第 ${i} 句` })),
      speakers: labels.map((label, i) => ({ label, displayName: `講者 ${i + 1}`, displayOrder: i + 1 })),
    })

    const heading = screen.getByRole('button', { name: /講者（5）/ })
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '改名：講者 1' })).not.toBeInTheDocument()

    await user.click(heading)
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '改名：講者 5' })).toBeInTheDocument()
  })

  it('keeps a small meeting\'s speakers open', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    expect(screen.getByRole('button', { name: /講者（2）/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '改名：主持人' })).toBeInTheDocument()
  })

  it("shows the speaker's name only on the first segment of each turn", async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    expect(segmentRow('歡迎收聽')).toHaveTextContent('主持人：歡迎收聽')
    expect(segmentRow('今天請到來賓')).not.toHaveTextContent('主持人')
    expect(segmentRow('大家好')).toHaveTextContent('講者 2：大家好')
    expect(segmentRow('先聊聊近況')).toHaveTextContent('主持人：先聊聊近況')
  })

  it('does not start a new turn after a cleared segment of the same speaker', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: [
        multiSpeakerTranscript.segments[0],
        { ...multiSpeakerTranscript.segments[2], text: '' },
        multiSpeakerTranscript.segments[3],
      ],
    })

    expect(segmentRow('先聊聊近況')).not.toHaveTextContent('主持人')
  })

  it('lists the speakers who have segments above the transcript, each with its own colour', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    const panel = screen.getByRole('list', { name: '講者' })
    const items = within(panel).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['主持人', '講者 2'])
    const colours = items.map((item) => (item.querySelector('[data-speaker-colour]') as HTMLElement).style.backgroundColor)
    expect(new Set(colours).size).toBe(2)
  })

  it("marks a speaker's turn in the transcript with the speaker's colour", async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    const panelColour = (within(screen.getByRole('list', { name: '講者' })).getByText('講者 2').closest('li')
      ?.querySelector('[data-speaker-colour]') as HTMLElement).style.backgroundColor
    const turnColour = (segmentRow('大家好').querySelector('[data-speaker-colour]') as HTMLElement).style.backgroundColor
    expect(turnColour).toBe(panelColour)
  })

  it('does not list a speaker whose segments have all been cleared', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: [
        ...multiSpeakerTranscript.segments,
        { id: 'seg-d5', startTime: 8, endTime: 9, speakerLabel: 'S3', text: '', originalText: '被清空的話' },
      ],
    })

    const items = within(screen.getByRole('list', { name: '講者' })).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['主持人', '講者 2'])
  })

  it('hides everything about speakers when only one speaker was found', async () => {
    stubDesktopLayout()
    await renderCompletedJob(soloTranscript)

    expect(screen.queryByRole('list', { name: '講者' })).not.toBeInTheDocument()
    expect(segmentRow('歡迎收聽')).not.toHaveTextContent('講者 1')
  })

  it("counts only segments that aren't cleared when deciding whether there is more than one speaker", async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: multiSpeakerTranscript.segments.map((segment) => (segment.speakerLabel === 'S2' ? { ...segment, text: '' } : segment)),
    })

    expect(screen.queryByRole('list', { name: '講者' })).not.toBeInTheDocument()
    expect(segmentRow('歡迎收聽')).not.toHaveTextContent('主持人')
  })

  it('exports subtitles with the speakers\' names', async () => {
    const user = userEvent.setup()
    let exported: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exported = blob as Blob
      return 'blob:export'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載字幕（SRT）' }))

    expect(await exported?.text()).toContain('00:00:04,000 --> 00:00:06,000\n講者 2：大家好\n')
  })
})

describe('JobDetailPage speaker name suggestions (講者名字建議, COMPLETED)', () => {
  const panel = () => screen.getByRole('list', { name: '講者' })
  const suggestionFor = (label: string, name: string) => ({
    speakerLabel: label, name, evidenceStartTime: 4, evidenceText: `大家好，我是${name}`, status: 'pending' as const,
  })
  // Both speakers still have their default names.
  const unnamed: Transcript = {
    ...multiSpeakerTranscript,
    speakers: [{ label: 'S1', displayName: '講者 1', displayOrder: 1 }, { label: 'S2', displayName: '講者 2', displayOrder: 2 }],
  }
  const renamedTo = (label: string, name: string) => ({
    speaker: { label, displayName: name, displayOrder: label === 'S1' ? 1 : 2 }, revision: 1,
  })

  it('suggests a name with the line it comes from, which plays when its time is clicked', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    await renderCompletedJob(multiSpeakerTranscript)

    const suggestion = await screen.findByRole('group', { name: '講者 2 可能是 李大華' })
    expect(suggestion).toHaveTextContent('大家好，我是李大華')
    await user.click(within(suggestion).getByRole('button', { name: '0:04' }))
    expect((document.querySelector('audio') as HTMLMediaElement).currentTime).toBe(4)
  })

  it('renames the speaker when a suggestion is applied, and marks it applied', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    vi.mocked(transcriptApi.renameSpeaker).mockResolvedValue(renamedTo('S2', '李大華'))
    vi.mocked(speakerSuggestionsApi.setStatus).mockResolvedValue({ ...suggestionFor('S2', '李大華'), status: 'applied' })
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(within(await screen.findByRole('group', { name: '講者 2 可能是 李大華' })).getByRole('button', { name: '套用' }))

    expect(transcriptApi.renameSpeaker).toHaveBeenCalledWith('job-1', 'S2', '李大華')
    expect(speakerSuggestionsApi.setStatus).toHaveBeenCalledWith('job-1', 'S2', 'applied')
    expect(await within(panel()).findByRole('button', { name: '改名：李大華' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /可能是/ })).not.toBeInTheDocument()
  })

  it('stops suggesting once the suggestion is dismissed', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    vi.mocked(speakerSuggestionsApi.setStatus).mockResolvedValue({ ...suggestionFor('S2', '李大華'), status: 'dismissed' })
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(within(await screen.findByRole('group', { name: '講者 2 可能是 李大華' })).getByRole('button', { name: '忽略' }))

    expect(speakerSuggestionsApi.setStatus).toHaveBeenCalledWith('job-1', 'S2', 'dismissed')
    expect(screen.queryByRole('group', { name: /可能是/ })).not.toBeInTheDocument()
    expect(transcriptApi.renameSpeaker).not.toHaveBeenCalled()
  })

  it('applies every suggestion at once, keeping any that fails to apply', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S1', '王小明'), suggestionFor('S2', '李大華')])
    vi.mocked(transcriptApi.renameSpeaker).mockImplementation(async (_jobId, label, name) => {
      if (label === 'S2') throw new Error('network')
      return renamedTo(label, name)
    })
    vi.mocked(speakerSuggestionsApi.setStatus).mockResolvedValue({ ...suggestionFor('S1', '王小明'), status: 'applied' })
    await renderCompletedJob(unnamed)

    await user.click(await screen.findByRole('button', { name: '全部套用（2）' }))

    expect(await within(panel()).findByRole('button', { name: '改名：王小明' })).toBeInTheDocument()
    expect(speakerSuggestionsApi.setStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: '講者 2 可能是 李大華' })).toBeInTheDocument()
    expect(await screen.findByText('套用失敗：講者 2')).toBeInTheDocument()
  })

  it('does not suggest anything for a speaker the user already named, or a suggestion already dealt with', async () => {
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([
      suggestionFor('S1', '王小明'), // S1 is already 主持人
      { ...suggestionFor('S2', '李大華'), status: 'dismissed' },
    ])
    await renderCompletedJob(multiSpeakerTranscript)
    await screen.findByRole('list', { name: '講者' })

    await waitFor(() => expect(speakerSuggestionsApi.list).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /可能是/ })).not.toBeInTheDocument()
  })

  it('suggests inside the Source Sheet too (narrow viewport)', async () => {
    const user = userEvent.setup()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(screen.getByRole('button', { name: '來源' }))

    expect(await within(await screen.findByRole('dialog')).findByRole('group', { name: '講者 2 可能是 李大華' })).toBeInTheDocument()
  })
})

describe('JobDetailPage renaming a speaker (COMPLETED, desktop layout)', () => {
  const panel = () => screen.getByRole('list', { name: '講者' })

  async function startRenaming(currentName: string) {
    const user = userEvent.setup()
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)
    await user.click(within(panel()).getByRole('button', { name: `改名：${currentName}` }))
    return { user, input: within(panel()).getByRole('textbox', { name: '講者名稱' }) }
  }

  it('renames a speaker in place, everywhere the name is shown, and marks the summary as possibly 過時', async () => {
    vi.mocked(transcriptApi.renameSpeaker).mockResolvedValue({
      speaker: { label: 'S2', displayName: '王小明', displayOrder: 2 },
      revision: 1,
    })
    const { user, input } = await startRenaming('講者 2')
    expect(input).toHaveValue('講者 2')

    await user.clear(input)
    await user.type(input, '王小明{Enter}')

    expect(transcriptApi.renameSpeaker).toHaveBeenCalledWith('job-1', 'S2', '王小明')
    expect(await within(panel()).findByRole('button', { name: '改名：王小明' })).toBeInTheDocument()
    expect(screen.getByText('大家好').closest('[data-segment-index]')).toHaveTextContent('王小明：大家好')
    expect(screen.getByText('逐字稿已修改，摘要與章節可能過時')).toBeInTheDocument()
  })

  it('restores the default name when the name is cleared', async () => {
    vi.mocked(transcriptApi.renameSpeaker).mockResolvedValue({
      speaker: { label: 'S1', displayName: '講者 1', displayOrder: 1 },
      revision: 1,
    })
    const { user, input } = await startRenaming('主持人')

    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(transcriptApi.renameSpeaker).toHaveBeenCalledWith('job-1', 'S1', '')
    expect(await within(panel()).findByRole('button', { name: '改名：講者 1' })).toBeInTheDocument()
  })

  it('cancels on Escape without saving', async () => {
    const { user, input } = await startRenaming('講者 2')

    await user.type(input, '改到一半{Escape}')

    expect(transcriptApi.renameSpeaker).not.toHaveBeenCalled()
    expect(within(panel()).getByRole('button', { name: '改名：講者 2' })).toBeInTheDocument()
  })

  it('does not send anything when Enter is pressed without a change', async () => {
    const { user } = await startRenaming('講者 2')

    await user.keyboard('{Enter}')

    expect(transcriptApi.renameSpeaker).not.toHaveBeenCalled()
    expect(within(panel()).queryByRole('textbox', { name: '講者名稱' })).not.toBeInTheDocument()
  })

  it('cancels a rename on Escape inside the Source Sheet without closing the Sheet (narrow viewport)', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(multiSpeakerTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    const sheet = await screen.findByRole('dialog')

    await user.click(within(sheet).getByRole('button', { name: '改名：講者 2' }))
    await user.keyboard('{Escape}')

    expect(within(sheet).queryByRole('textbox', { name: '講者名稱' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps what the user typed and says so when saving fails', async () => {
    vi.mocked(transcriptApi.renameSpeaker).mockRejectedValue(new Error('network'))
    const { user, input } = await startRenaming('講者 2')

    await user.clear(input)
    await user.type(input, '王小明{Enter}')

    expect(await screen.findByText('改名失敗')).toBeInTheDocument()
    expect(input).toHaveValue('王小明')
  })
})

describe("JobDetailPage changing a segment's speaker (COMPLETED, desktop layout)", () => {
  const segmentRow = (text: string) => screen.getByText(text).closest('[data-segment-index]') as HTMLElement
  const speakerPanel = () => screen.queryByRole('list', { name: '講者' })

  async function openSpeakerMenu(transcript: Transcript, segmentText: string) {
    const user = userEvent.setup()
    stubDesktopLayout()
    await renderCompletedJob(transcript)
    await user.click(within(segmentRow(segmentText)).getByRole('button', { name: '改講者' }))
    return { user, menu: await screen.findByRole('menu') }
  }

  it('offers the speakers who have segments, marking the current one, and a way to add a speaker', async () => {
    const { menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    const choices = within(menu).getAllByRole('menuitemradio')
    expect(choices.map((choice) => choice.textContent)).toEqual(['主持人', '講者 2'])
    expect(choices[0]).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitem', { name: '新增講者…' })).toBeInTheDocument()
  })

  it('gives the segment to the chosen speaker and marks the summary as possibly 過時', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...multiSpeakerTranscript.segments[1], speakerLabel: 'S2' },
      speakers: multiSpeakerTranscript.speakers,
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    await user.click(within(menu).getByRole('menuitemradio', { name: '講者 2' }))

    expect(transcriptApi.assignSegmentSpeaker).toHaveBeenCalledWith('job-1', 'seg-d2', { speakerLabel: 'S2' })
    await waitFor(() => expect(segmentRow('今天請到來賓')).toHaveTextContent('講者 2：今天請到來賓'))
    expect(screen.getByText('逐字稿已修改，摘要與章節可能過時')).toBeInTheDocument()
  })

  it("opens the same menu from the speaker's name at the start of a turn", async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(within(segmentRow('大家好')).getByRole('button', { name: '改講者：講者 2' }))

    expect(within(await screen.findByRole('menu')).getAllByRole('menuitemradio')).toHaveLength(2)
  })

  it('does not send anything when the current speaker is chosen', async () => {
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    await user.click(within(menu).getByRole('menuitemradio', { name: '主持人' }))

    expect(transcriptApi.assignSegmentSpeaker).not.toHaveBeenCalled()
  })

  it('adds a new speaker, with a name, for the segment', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...multiSpeakerTranscript.segments[3], speakerLabel: 'S4' },
      speakers: [...multiSpeakerTranscript.speakers, { label: 'S4', displayName: '李大華', displayOrder: 4 }],
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '先聊聊近況')

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.type(within(segmentRow('先聊聊近況')).getByRole('textbox', { name: '新講者名稱' }), '李大華{Enter}')

    expect(transcriptApi.assignSegmentSpeaker).toHaveBeenCalledWith('job-1', 'seg-d4', { newSpeaker: { name: '李大華' } })
    expect(await within(speakerPanel()!).findByRole('button', { name: '改名：李大華' })).toBeInTheDocument()
  })

  it('shows the speakers as soon as a single-speaker recording gets a second one', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...soloTranscript.segments[2], speakerLabel: 'S2' },
      speakers: [...soloTranscript.speakers, { label: 'S2', displayName: '講者 2', displayOrder: 2 }],
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(soloTranscript, '大家好')
    expect(speakerPanel()).not.toBeInTheDocument()

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.keyboard('{Enter}')

    expect(transcriptApi.assignSegmentSpeaker).toHaveBeenCalledWith('job-1', 'seg-d3', { newSpeaker: { name: '' } })
    expect(await screen.findByRole('list', { name: '講者' })).toBeInTheDocument()
    expect(segmentRow('大家好')).toHaveTextContent('講者 2：大家好')
  })

  it('shows both speakers when a transcript from before speaker separation gets its first new speaker', async () => {
    // Such a transcript has no speakers at all; the backend gives the other segments to a new 講者 1.
    const oldTranscript: Transcript = {
      ...soloTranscript,
      segments: soloTranscript.segments.map((segment) => ({ ...segment, speakerLabel: null })),
      speakers: [],
    }
    const speakers = [
      { label: 'S1', displayName: '講者 1', displayOrder: 1 },
      { label: 'S2', displayName: '講者 2', displayOrder: 2 },
    ]
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...oldTranscript.segments[2], speakerLabel: 'S2' },
      speakers,
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(oldTranscript, '大家好')
    vi.mocked(transcriptApi.get).mockResolvedValue({
      ...oldTranscript,
      revision: 1,
      segments: oldTranscript.segments.map((segment, i) => ({ ...segment, speakerLabel: i === 2 ? 'S2' : 'S1' })),
      speakers,
    })

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('list', { name: '講者' })).toBeInTheDocument()
    expect(segmentRow('歡迎收聽')).toHaveTextContent('講者 1：歡迎收聽')
    expect(segmentRow('大家好')).toHaveTextContent('講者 2：大家好')
  })

  it('cancels adding a speaker on Escape', async () => {
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '先聊聊近況')

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.keyboard('王{Escape}')

    expect(screen.queryByRole('textbox', { name: '新講者名稱' })).not.toBeInTheDocument()
    expect(transcriptApi.assignSegmentSpeaker).not.toHaveBeenCalled()
  })

  it('says so when changing the speaker fails', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockRejectedValue(new Error('network'))
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    await user.click(within(menu).getByRole('menuitemradio', { name: '講者 2' }))

    expect(await screen.findByText('改講者失敗')).toBeInTheDocument()
  })
})

describe('JobDetailPage speaker stats (講者數據, COMPLETED, desktop layout)', () => {
  const statsTable = () => screen.getByRole('table', { name: '每位講者的發言' })
  const rowOf = (name: string) => within(statsTable()).getByRole('row', { name: new RegExp(`^${name}`) })

  it('shows a tile only when there are two or more speakers', async () => {
    stubDesktopLayout()
    await renderCompletedJob(soloTranscript)

    await screen.findByRole('list', { name: 'AI 工具' })
    expect(screen.queryByRole('button', { name: '講者數據' })).not.toBeInTheDocument()
  })

  it('lists each speaker’s talk time, share, turns and longest turn, and the turn changes', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    expect(await screen.findByRole('button', { name: '講者數據' })).toHaveAccessibleDescription('2 位講者 · 講最多：主持人')
    await openStudioTool('講者數據')

    // 主持人: 0–4 (one turn) and 6–8; 講者 2: 4–6. 講者 3 has no segments left and isn't listed.
    expect(within(rowOf('主持人')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['00:06', '75%', '2', '00:04', '00:03'])
    expect(within(rowOf('講者 2')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['00:02', '25%', '1', '00:02', '00:02'])
    expect(within(statsTable()).queryByRole('row', { name: /講者 3/ })).not.toBeInTheDocument()
    expect(screen.getByText('換人 2 次')).toBeInTheDocument()
  })

  it('works the numbers out again when a segment is given to another speaker', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...multiSpeakerTranscript.segments[1], speakerLabel: 'S2' },
      speakers: multiSpeakerTranscript.speakers,
      revision: 1,
    })
    await renderCompletedJob(multiSpeakerTranscript)
    await openStudioTool('講者數據')

    const row = screen.getByText('今天請到來賓').closest('[data-segment-index]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '改講者' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemradio', { name: '講者 2' }))

    await waitFor(() =>
      expect(within(rowOf('講者 2')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['00:04', '50%', '1', '00:04', '00:04']))
  })

  describe('questions and interruptions judged by AI (估計)', () => {
    const analysed: SpeakerInsights = {
      ...noInsights,
      status: 'COMPLETED',
      sourceRevision: 0,
      model: 'qwen3:14b',
      completedAt: '2026-10-03T10:00:00Z',
      items: [
        { kind: 'question', speakerLabel: 'S1', interruptedLabel: null, startTime: 2, text: '今天請到來賓' },
        { kind: 'interruption', speakerLabel: 'S2', interruptedLabel: 'S1', startTime: 4, text: '大家好' },
      ],
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('analyses on request, then lists the questions and possible interruptions with who and when', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.request).mockResolvedValue({ ...noInsights, status: 'GENERATING' })
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('講者數據')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      await user.click(screen.getByRole('button', { name: '分析問題與打斷' }))
      expect(speakerInsightsApi.request).toHaveBeenCalledWith('job-1')
      expect(screen.getByText('分析中…')).toBeInTheDocument()

      vi.mocked(speakerInsightsApi.get).mockResolvedValue(analysed)
      await vi.advanceTimersByTimeAsync(3000)

      const questions = await screen.findByRole('list', { name: '提出的問題' })
      expect(within(questions).getByRole('listitem')).toHaveTextContent('主持人')
      expect(within(questions).getByRole('listitem')).toHaveTextContent('今天請到來賓')
      const interruptions = screen.getByRole('list', { name: '可能的打斷' })
      expect(within(interruptions).getByRole('listitem')).toHaveTextContent('講者 2 打斷了 主持人')
      expect(screen.getByText(/AI 估計/)).toBeInTheDocument()
    })

    it('plays from where a question was asked', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue(analysed)
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('講者數據')

      const questions = await screen.findByRole('list', { name: '提出的問題' })
      fireEvent.click(within(questions).getByRole('button', { name: '0:02' }))

      expect((document.querySelector('audio') as HTMLMediaElement).currentTime).toBe(2)
    })

    it('says the analysis may be out of date once the transcript has changed', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue({ ...analysed, sourceRevision: 0 })
      await renderCompletedJob({ ...multiSpeakerTranscript, revision: 2 })
      await openStudioTool('講者數據')

      expect(await screen.findByText('逐字稿已修改，這份分析可能過時')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument()
    })

    it('offers only one way to try again when a re-analysis of out-of-date results failed', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue({ ...analysed, status: 'FAILED', failureReason: '分析失敗，請再試一次' })
      await renderCompletedJob({ ...multiSpeakerTranscript, revision: 2 })
      await openStudioTool('講者數據')

      expect(await screen.findByRole('button', { name: '再分析一次' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '重新分析' })).not.toBeInTheDocument()
      expect(screen.getByRole('list', { name: '提出的問題' })).toBeInTheDocument() // the earlier results stay
    })

    it('shows why it failed and offers to try again', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue({ ...noInsights, status: 'FAILED', failureReason: '模型回傳的格式不正確，請再分析一次' })
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('講者數據')

      expect(await screen.findByText('模型回傳的格式不正確，請再分析一次')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再分析一次' })).toBeInTheDocument()
    })
  })

  it('marks a speaker who talks very little', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: [
        { id: 'q1', startTime: 0, endTime: 100, speakerLabel: 'S1', text: '很長的開場', originalText: '很長的開場' },
        { id: 'q2', startTime: 100, endTime: 105, speakerLabel: 'S2', text: '好', originalText: '好' },
      ],
    })
    await openStudioTool('講者數據')

    expect(within(rowOf('講者 2')).getByText('發言很少')).toBeInTheDocument()
    expect(within(rowOf('主持人')).queryByText('發言很少')).not.toBeInTheDocument()
  })
})

describe('JobDetailPage segment editing (COMPLETED, desktop layout)', () => {
  function editButtonFor(text: string) {
    const row = screen.getByText(text).closest('[data-segment-index]')
    if (!(row instanceof HTMLElement)) throw new Error(`no segment row for ${text}`)
    return within(row).getByRole('button', { name: '編輯片段' })
  }

  it('edits a segment in place and saves it on Enter', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句改好了', originalText: '第二句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    expect(editor).toHaveValue('第二句')
    await user.clear(editor)
    await user.type(editor, '第二句改好了{Enter}')

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-3', '第二句改好了')
    expect(await screen.findByText('第二句改好了')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
  })

  it('cancels editing on Escape without saving', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '亂打{Escape}')

    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
    expect(screen.getByText('第二句')).toBeInTheDocument()
  })

  it('keeps what the user typed and says so when saving fails', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockRejectedValue(new Error('network'))
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '沒存到{Enter}')

    expect(await screen.findByText('儲存失敗')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toHaveValue('沒存到')
  })

  it('shows that it is saving and blocks further input meanwhile', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValue(new Promise(() => {}))
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')

    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toBeDisabled()
    expect(screen.getByText('儲存中…')).toBeInTheDocument()
  })

  it('saves and cancels from the buttons under the editor too (touch keyboards have no Esc)', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句改好了', originalText: '第二句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '亂打')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '第二句改好了')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-3', '第二句改好了')
    expect(await screen.findByText('第二句改好了')).toBeInTheDocument()
  })

  it('pauses auto-follow while editing, without pausing playback', async () => {
    const user = userEvent.setup()
    const media = await renderGappedTranscriptOnDesktop()
    playTo(media, 9)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')

    await user.click(editButtonFor('第一句'))

    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
    expect(pause).not.toHaveBeenCalled()
  })

  it('cancels an edit on Escape inside the Source Sheet without closing the Sheet (narrow viewport)', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    await screen.findByText('第二句')

    await user.click(editButtonFor('第二句'))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('第二句')).toBeInTheDocument()
  })

  it('does not close the editor of another segment when an earlier save finishes', async () => {
    const user = userEvent.setup()
    let finishFirstSave: () => void = () => {}
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirstSave = () =>
          resolve({
            segment: { id: 'seg-2', startTime: 5, endTime: 8, speakerLabel: null, text: '第一句改', originalText: '第一句' },
            revision: 1,
          })
      }),
    )
    await renderGappedTranscriptOnDesktop()
    await user.click(editButtonFor('第一句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')

    await user.click(editButtonFor('第三句'))
    finishFirstSave()

    expect(await screen.findByText('第一句改')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toHaveValue('第三句')
  })

  it('does not send anything when Enter is pressed without a change', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '{Enter}')

    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
  })

  it("gives keyboard focus back to the segment's edit button when the editor closes", async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.keyboard('{Escape}')

    expect(editButtonFor('第二句')).toHaveFocus()
  })

  it('keeps the search counter within the matches that remain after an edit', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-4', startTime: 12, endTime: 15, speakerLabel: null, text: '最後一段', originalText: '第三句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()
    await user.type(searchbox(), '句')
    await user.click(screen.getByRole('button', { name: '上一個符合結果' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()

    // The search highlights split 「第三句」 into several elements, so pick the third segment's button.
    await user.click(screen.getAllByRole('button', { name: '編輯片段' })[2])
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '最後一段{Enter}')

    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
  })
})

describe('JobDetailPage edited and cleared segments (COMPLETED, desktop layout)', () => {
  const editedTranscript: Transcript = {
    ...gappedTranscript,
    revision: 2,
    segments: [
      { id: 'seg-a', startTime: 5, endTime: 8, speakerLabel: null, text: '強風豪雨', originalText: '強風好雨' },
      { id: 'seg-b', startTime: 8, endTime: 10, speakerLabel: null, text: '', originalText: '請不吝點讚訂閱' },
      { id: 'seg-c', startTime: 12, endTime: 15, speakerLabel: null, text: '沒改過', originalText: '沒改過' },
    ],
  }

  async function renderEdited() {
    stubDesktopLayout()
    await renderCompletedJob(editedTranscript)
    await screen.findByText('強風豪雨')
  }

  function row(index: number) {
    const element = document.querySelector(`[data-segment-index="${index}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no segment row ${index}`)
    return within(element)
  }

  it('marks a segment whose text differs from the original text, and only that one', async () => {
    await renderEdited()

    expect(row(0).getByText('已編輯')).toBeInTheDocument()
    expect(row(2).queryByText('已編輯')).not.toBeInTheDocument()
    expect(row(2).queryByRole('button', { name: '還原成原始文字' })).not.toBeInTheDocument()
  })

  it('restores an edited segment to its original text', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[0], text: '強風好雨' },
      revision: 3,
    })
    await renderEdited()

    await user.click(row(0).getByRole('button', { name: '還原成原始文字' }))

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-a', '強風好雨')
    expect(await screen.findByText('強風好雨')).toBeInTheDocument()
    expect(row(0).queryByText('已編輯')).not.toBeInTheDocument()
  })

  it('shows a cleared segment as a faint row that can be restored', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[1], text: '請不吝點讚訂閱' },
      revision: 3,
    })
    await renderEdited()

    expect(row(1).getByText('已清空')).toBeInTheDocument()
    expect(screen.queryByText('請不吝點讚訂閱')).not.toBeInTheDocument()

    await user.click(row(1).getByRole('button', { name: '還原：請不吝點讚訂閱' }))

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-b', '請不吝點讚訂閱')
    expect(await screen.findByText('請不吝點讚訂閱')).toBeInTheDocument()
  })

  it('does not find a cleared segment when searching', async () => {
    const user = userEvent.setup()
    await renderEdited()

    await user.type(searchbox(), '點讚')

    expect(screen.getByText('沒有符合的結果')).toBeInTheDocument()
  })

  it('clears a segment when its text is saved empty', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[2], text: '' },
      revision: 3,
    })
    await renderEdited()

    await user.click(row(2).getByRole('button', { name: '編輯片段' }))
    await user.clear(screen.getByRole('textbox', { name: '編輯片段文字' }))
    await user.keyboard('{Enter}')

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-c', '')
    expect(await row(2).findByText('已清空')).toBeInTheDocument()
  })

  it('still highlights a cleared segment when playback is inside it', async () => {
    await renderEdited()

    playTo(renderedMediaElement(), 9)

    expect(currentSegmentText()).toContain('已清空')
  })

  it('gives focus back to the segment and blocks a second click while restoring', async () => {
    const user = userEvent.setup()
    let finishRestore: () => void = () => {}
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValue(
      new Promise((resolve) => {
        finishRestore = () => resolve({ segment: { ...editedTranscript.segments[0], text: '強風好雨' }, revision: 3 })
      }),
    )
    await renderEdited()

    const restore = row(0).getByRole('button', { name: '還原成原始文字' })
    await user.click(restore)
    expect(restore).toBeDisabled()
    finishRestore()

    await screen.findByText('強風好雨')
    expect(row(0).getByRole('button', { name: '編輯片段' })).toHaveFocus()
    expect(transcriptApi.updateSegmentText).toHaveBeenCalledTimes(1)
  })

  it('offers no restore for a segment whose original text was empty to begin with', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...editedTranscript,
      segments: [{ id: 'seg-z', startTime: 5, endTime: 8, speakerLabel: null, text: '', originalText: '' }],
    })
    await screen.findByText('已清空')

    expect(row(0).queryByRole('button', { name: /^還原/ })).not.toBeInTheDocument()
  })
})
