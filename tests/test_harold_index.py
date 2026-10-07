"""Tests for bin/harold-index: link resolution, backlinks, traversal, stale and broken flags,
incremental rebuilds, archives and graph.json. Run: python3 -m unittest discover -s tests -p 'test_*.py'
(tests/index.test.js runs it as part of `node --test tests/*.test.js`)."""
import contextlib, importlib.machinery, importlib.util, io, json, os, shutil, sqlite3, tempfile, textwrap, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_loader = importlib.machinery.SourceFileLoader('harold_index', os.path.join(HERE, '..', 'bin', 'harold-index'))
_spec = importlib.util.spec_from_loader('harold_index', _loader)
hi = importlib.util.module_from_spec(_spec)
_loader.exec_module(hi)

TODAY = '2026-06-30'
NOTES = {
    'vault/people/Jane Doe.md': '''
        ---
        tags: [person]
        company: Acme Corp
        last_updated: 2026-06-25
        ---
        # Jane Doe

        CEO of [[Acme Corp#Team|Acme]].
        ''',
    'vault/companies/Acme Corp.md': '''
        ---
        tags: [company]
        aliases:
          - Acme Inc
        last_updated: 2026-05-01
        ---
        # Acme Corp

        Run by [[jane doe]]. Building [[projects/rocket]].
        Still to write up: [[Missing Note]].
        Advisor: [Bob](../people/Bob%20Smith.md)
        ''',
    'vault/people/Bob Smith.md': '''
        ---
        last_updated: 2026-06-20
        ---
        # Bob Smith

        Advises [[Acme Inc]].
        ''',
    'vault/projects/rocket.md': '''
        ---
        last_updated: 2026-06-28
        ---
        # Rocket

        Lead: [[Bob Smith]]. See [[D-1]].
        ''',
    'vault/decisions/D-1.md': '''
        ---
        date: 2026-06-01
        ---
        # D-1: Build the rocket

        For [[Rocket]].
        ''',
    'vault/meetings/2026-01-01-kickoff.md': '''
        ---
        date: 2026-01-01
        attendees: [Jane Doe, Bob Smith]   # who was there
        ---
        # Kickoff

        `[[Not A Link]]` is how you write a link.
        ''',
    'vault/archive/Old Partner.md': '''
        ---
        last_updated: 2024-01-01
        ---
        # Old Partner

        Once worked with [[Acme Corp]] on the zeppelin.
        ''',
    'memory/CLAUDE-archive.md': '''
        # Working memory archive

        The 2025 zeppelin plan, moved out of working memory.
        ''',
    'projects/side/notes.md': '''
        # Side project notes

        Talk to [[Bob Smith]] about the hovercraft.
        ''',
    'harold/projects.md': '''
        # Project map

        ## Side
        - folder: projects/side
        ''',
    'vault/people/Lonely.md': '''
        ---
        last_updated: 2026-06-29
        ---
        # Lonely

        Nobody links here.
        ''',
}


def write(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as fh: fh.write(textwrap.dedent(text).lstrip('\n'))
    st = os.stat(p); os.utime(p, (st.st_atime, st.st_mtime + 2))  # a distinct mtime even within one second


class IndexTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='harold-index-test-')
        os.makedirs(os.path.join(self.root, 'harold'))
        for rel, text in NOTES.items(): write(self.root, rel, text)
        self.env = {k: os.environ.get(k) for k in ('HAROLD_TODAY', 'HAROLD_STALE_DAYS')}
        os.environ['HAROLD_TODAY'] = TODAY
        os.environ.pop('HAROLD_STALE_DAYS', None)
        hi.set_root(self.root)
        self.build()

    def tearDown(self):
        for k, v in self.env.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v
        shutil.rmtree(self.root)

    def build(self, full=False):
        return hi.build(full=full, quiet=True)

    def graph(self):
        con = sqlite3.connect(hi.DB)
        try: return hi.Graph(con)
        finally: con.close()

    def edges(self):
        con = sqlite3.connect(hi.DB)
        try: return {(s, d, k) for s, d, k in con.execute('SELECT src, dst, kind FROM edges')}
        finally: con.close()

    # ── resolution ──
    def test_wikilink_with_heading_and_alias_text(self):
        self.assertIn(('vault/people/Jane Doe.md', 'vault/companies/Acme Corp.md', 'wikilink'), self.edges())

    def test_wikilink_case_insensitive(self):
        self.assertIn(('vault/companies/Acme Corp.md', 'vault/people/Jane Doe.md', 'wikilink'), self.edges())

    def test_wikilink_to_frontmatter_alias(self):
        self.assertIn(('vault/people/Bob Smith.md', 'vault/companies/Acme Corp.md', 'wikilink'), self.edges())

    def test_wikilink_by_path_and_by_title(self):
        e = self.edges()
        self.assertIn(('vault/companies/Acme Corp.md', 'vault/projects/rocket.md', 'wikilink'), e)  # [[projects/rocket]]
        self.assertIn(('vault/decisions/D-1.md', 'vault/projects/rocket.md', 'wikilink'), e)        # [[Rocket]]: filename rocket.md

    def test_markdown_link_relative_and_url_encoded(self):
        self.assertIn(('vault/companies/Acme Corp.md', 'vault/people/Bob Smith.md', 'mdlink'), self.edges())

    def test_frontmatter_fields(self):
        e = self.edges()
        self.assertIn(('vault/people/Jane Doe.md', 'vault/companies/Acme Corp.md', 'frontmatter:company'), e)
        self.assertIn(('vault/meetings/2026-01-01-kickoff.md', 'vault/people/Jane Doe.md', 'frontmatter:attendees'), e)
        self.assertIn(('vault/meetings/2026-01-01-kickoff.md', 'vault/people/Bob Smith.md', 'frontmatter:attendees'), e)

    def test_inline_code_is_not_a_link(self):
        g = self.graph()
        self.assertNotIn('vault/meetings/2026-01-01-kickoff.md', g.broken)

    # ── backlinks and traversal ──
    def test_backlinks(self):
        g = self.graph()
        self.assertEqual(set(g.inn['vault/companies/Acme Corp.md']), {'vault/people/Jane Doe.md', 'vault/people/Bob Smith.md', 'vault/archive/Old Partner.md'})
        out = io.StringIO()
        with contextlib.redirect_stdout(out): hi.cmd_backlinks('Acme Corp')
        self.assertIn('3 backlinks', out.getvalue())
        self.assertIn('Advises [[Acme Inc]]', out.getvalue())

    def test_related_direct_first_then_depth_two(self):
        g = self.graph()
        rows, _, _ = hi.related(g, ['vault/people/Jane Doe.md'], depth=1)
        paths = [r['path'] for r in rows]
        self.assertEqual(paths[0], 'vault/companies/Acme Corp.md')  # linked both ways
        self.assertEqual(rows[0]['relation'], 'both')
        self.assertNotIn('vault/projects/rocket.md', paths)       # two hops away
        rows2, _, _ = hi.related(g, ['vault/people/Jane Doe.md'], depth=2)
        by = {r['path']: r for r in rows2}
        self.assertIn('vault/projects/rocket.md', by)
        self.assertEqual(by['vault/projects/rocket.md']['relation'], 'via')
        self.assertIn('Acme Corp', by['vault/projects/rocket.md']['shared_via'])
        direct = [r for r in rows2 if r['relation'] in ('both', 'outgoing', 'backlink')]
        self.assertEqual(rows2[:len(direct)], direct)  # direct links rank above two-hop notes

    def test_shared_links_at_depth_one(self):
        # Bob and Jane share two connectors (Acme Corp, the kickoff meeting) without linking each other
        rows, _, _ = hi.related(self.graph(), ['vault/people/Jane Doe.md'], depth=1)
        bob = [r for r in rows if r['path'] == 'vault/people/Bob Smith.md']
        self.assertEqual(len(bob), 1)
        self.assertEqual(bob[0]['relation'], 'shared')
        self.assertEqual(bob[0]['shared'], 2)

    def test_start_resolution(self):
        g = self.graph()
        con = sqlite3.connect(hi.DB)
        try:
            self.assertEqual(hi.find_start(g, con, 'vault/people/Jane Doe.md')[0], ['vault/people/Jane Doe.md'])
            self.assertEqual(hi.find_start(g, con, 'acme inc'), (['vault/companies/Acme Corp.md'], 'name'))
            starts, how = hi.find_start(g, con, 'rocket build')
            self.assertEqual(how, 'search'); self.assertTrue(starts)
        finally: con.close()

    # ── what it doesn't know ──
    def test_stale_flag_and_threshold(self):
        g = self.graph()
        self.assertTrue(hi.is_stale(g.node('vault/companies/Acme Corp.md')))       # 60 days
        self.assertFalse(hi.is_stale(g.node('vault/people/Jane Doe.md')))          # 5 days
        self.assertFalse(hi.is_stale(g.node('vault/meetings/2026-01-01-kickoff.md')))  # dated record, never stale
        os.environ['HAROLD_STALE_DAYS'] = '90'
        self.assertFalse(hi.is_stale(g.node('vault/companies/Acme Corp.md')))

    def test_broken_and_orphan_gaps(self):
        g = self.graph()
        self.assertEqual([t for t, _, _ in g.broken['vault/companies/Acme Corp.md']], ['Missing Note'])
        gaps = ' '.join(hi.gaps(g, 'vault/companies/Acme Corp.md', []))
        self.assertIn('last updated 60 days ago', gaps)
        self.assertIn('1 broken link ([[Missing Note]])', gaps)
        self.assertIn('orphan', ' '.join(hi.gaps(g, 'vault/people/Lonely.md', [])))
        self.assertIn('no meeting notes linked', gaps)

    def test_related_output_ends_with_gaps_line(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out): hi.cmd_related('Acme Corp')
        last = out.getvalue().strip().split('\n')[-1]
        self.assertTrue(last.startswith('gaps: Acme Corp: last updated 60 days ago'), last)

    def test_search_lists_links_per_hit(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out): hi.search('Advises')
        self.assertIn('↳ links: Acme Corp', out.getvalue())

    # ── always up to date ──
    def test_incremental_picks_up_new_note_and_deleted_link(self):
        self.assertEqual(hi.stale_reason(), '')
        write(self.root, 'vault/intel/missing-note.md', '# Missing Note\n\nNow written.\n')
        self.assertTrue(hi.stale_reason().startswith('stale'))
        msg = self.build()
        self.assertIn('(1 read,', msg)
        g = self.graph()
        self.assertNotIn('vault/companies/Acme Corp.md', g.broken)  # unchanged file's broken link now resolves
        self.assertIn('vault/intel/missing-note.md', g.out['vault/companies/Acme Corp.md'])
        write(self.root, 'vault/people/Jane Doe.md', NOTES['vault/people/Jane Doe.md'].replace('CEO of [[Acme Corp#Team|Acme]].', 'CEO.'))
        self.build()
        e = self.edges()
        self.assertNotIn(('vault/people/Jane Doe.md', 'vault/companies/Acme Corp.md', 'wikilink'), e)
        self.assertIn(('vault/people/Jane Doe.md', 'vault/companies/Acme Corp.md', 'frontmatter:company'), e)

    def test_incremental_notices_deleted_file(self):
        os.remove(os.path.join(self.root, 'vault/projects/rocket.md'))
        self.assertIn('1 deleted', hi.stale_reason())
        hi.refresh()
        g = self.graph()
        self.assertNotIn('vault/projects/rocket.md', g.nodes)
        self.assertIn('projects/rocket', [t for t, _, _ in g.broken['vault/companies/Acme Corp.md']])

    def test_incremental_matches_full(self):
        write(self.root, 'vault/people/Carol.md', '# Carol\n\nWorks with [[Bob Smith]] at [[Acme Inc]].\n')
        self.build(); inc = self.edges()
        self.build(full=True)
        self.assertEqual(inc, self.edges())

    # ── archives and project folders ──
    def test_archives_are_searchable_and_never_stale(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out): hi.search('zeppelin')
        self.assertIn('vault/archive/Old Partner.md', out.getvalue())
        self.assertIn('memory/CLAUDE-archive.md', out.getvalue())
        g = self.graph()
        self.assertEqual(g.node('vault/archive/Old Partner.md')['type'], 'archive')
        self.assertEqual(g.node('memory/CLAUDE-archive.md')['type'], 'archive')
        self.assertFalse(hi.is_stale(g.node('vault/archive/Old Partner.md')))  # two years old, archived
        self.assertIn('vault/archive/Old Partner.md', g.inn['vault/companies/Acme Corp.md'])

    def test_live_note_beats_archived_namesake(self):
        write(self.root, 'vault/archive/Jane Doe.md', '# Jane Doe\n\nThe old card.\n')
        self.build()
        self.assertIn(('vault/companies/Acme Corp.md', 'vault/people/Jane Doe.md', 'wikilink'), self.edges())

    def test_project_map_folders_are_indexed(self):
        self.assertIn(('projects/side/notes.md', 'vault/people/Bob Smith.md', 'wikilink'), self.edges())

    def test_nested_repository_is_not_indexed(self):
        write(self.root, 'projects/side/app/README.md', '# App\n\nSee [[Bob Smith]].\n')
        os.makedirs(os.path.join(self.root, 'projects/side/app/.git'))
        write(self.root, 'projects/side/more.md', '# More\n\nSee [[Bob Smith]].\n')
        self.build()
        srcs = {s for s, d, k in self.edges()}
        self.assertIn('projects/side/more.md', srcs)
        self.assertNotIn('projects/side/app/README.md', srcs)

    def test_graph_json_written_only_when_changed_and_has_no_text(self):
        self.assertTrue(hi.graph_json(quiet=True))
        self.assertFalse(hi.graph_json(quiet=True))
        with open(hi.GRAPH_JSON) as fh: raw = fh.read()
        j = json.loads(raw)
        self.assertEqual(j['node_fields'], ['path', 'title', 'type', 'last_updated'])
        self.assertIn(['vault/people/Jane Doe.md', 'Jane Doe', 'person', '2026-06-25'], j['nodes'])
        self.assertIn(['vault/people/Jane Doe.md', 'vault/companies/Acme Corp.md', 'wikilink'], j['edges'])
        self.assertIn(['vault/companies/Acme Corp.md', 'Missing Note', 'wikilink'], j['broken'])
        self.assertNotIn('CEO of', raw)
        write(self.root, 'vault/people/Dan.md', '# Dan\n')
        self.assertTrue(hi.graph_json(quiet=True))  # refreshes the index first, then rewrites


# ───────────────────────── project pulse ─────────────────────────
# tools/harold-connector/test/unit/pulse-fixture.json is shared with the connector's pulse.test.ts: the same files and
# commits must give bin/harold pulse and harold_pulse the same graph.json and the same text.
FIXTURE = os.path.join(HERE, '..', 'tools', 'harold-connector', 'test', 'unit', 'pulse-fixture.json')


class PulseTest(unittest.TestCase):
    def setUp(self):
        with open(FIXTURE, encoding='utf-8') as fh: self.fx = json.load(fh)
        self.root = tempfile.mkdtemp(prefix='harold-pulse-test-')
        self.env = {k: os.environ.get(k) for k in ('HAROLD_TODAY', 'HAROLD_STALE_DAYS', 'HAROLD_PULSE_DAYS', 'HAROLD_TZ')}
        os.environ.update(HAROLD_TODAY=self.fx['today'], HAROLD_TZ=self.fx['tz'])
        os.environ.pop('HAROLD_STALE_DAYS', None); os.environ.pop('HAROLD_PULSE_DAYS', None)
        for rel, text in self.fx['files'].items(): self.put(rel, text)
        self.git('init', '-q'); self.git('add', '-A'); self.git('commit', '-qm', 'init', date=self.fx['initial_commit'])
        for c in self.fx['commits']:
            for rel, text in c['files'].items(): self.put(rel, text)
            self.git('add', '-A'); self.git('commit', '-qm', c['message'], date=c['date'])
        hi.set_root(self.root)
        hi.build(quiet=True)

    def tearDown(self):
        for k, v in self.env.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v
        shutil.rmtree(self.root)

    def put(self, rel, text):
        p = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as fh: fh.write(text)
        st = os.stat(p); os.utime(p, (st.st_atime, st.st_mtime + 2))

    def git(self, *a, date=None):
        env = dict(os.environ, **({'GIT_AUTHOR_DATE': date, 'GIT_COMMITTER_DATE': date} if date else {}))
        import subprocess
        subprocess.run(['git', '-C', self.root, '-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', *a],
                       check=True, env=env, capture_output=True)

    def test_same_graph_json_and_text_as_the_connector(self):
        hi.graph_json(quiet=True)
        with open(hi.GRAPH_JSON, encoding='utf-8') as fh: self.assertEqual(fh.read(), self.fx['graph_json'])
        self.assertEqual(hi.pulse_text(hi.pulse_data()), self.fx['expected']['text'])
        self.assertEqual(hi.pulse_text(hi.pulse_data(include_inactive=True), True), self.fx['expected']['text_all'])
        self.assertEqual(hi.pulse_boot(hi.pulse_data()), self.fx['expected']['boot'])

    def test_activity_sources_and_next_step_sources(self):
        d = {p['name']: p for p in hi.pulse_data(include_inactive=True)['projects']}
        self.assertEqual(d['Pilot Program']['last']['path'], 'vault/meetings/2026-09-18-acme-kickoff.md')  # not the 2026-10-20 meeting
        self.assertEqual(d['Pilot Program']['next_step_source'], 'vault/projects/pilot.md (frontmatter)')
        self.assertEqual((d['Beta Launch']['last']['kind'], d['Beta Launch']['last']['date']), ('commit', '2026-10-03'))
        self.assertEqual(d['Beta Launch']['next_step_source'], 'projects/beta/README.md')  # the card's next_step is a placeholder comment
        self.assertEqual((d['Gamma Research']['card'], d['Gamma Research']['last']['via']), ('vault/projects/gamma-research.md', 'mention'))
        self.assertEqual(d['Gamma Research']['next_step_source'], 'harold/projects.md')
        self.assertEqual((d['Echo']['last']['via'], d['Echo']['next_step']), ('folder', 'call Bob'))
        self.assertIsNone(d['Delta']['last'])
        self.assertTrue(d['Delta']['quiet'])
        self.assertIsNone(d['Old Thing']['quiet'])  # paused: not judged

    def test_threshold_setting(self):
        os.environ['HAROLD_PULSE_DAYS'] = '40'
        data = hi.pulse_data()
        self.assertEqual([p['name'] for p in data['projects'] if p['quiet']], ['Delta'])
        self.assertEqual(data['pulse_days'], 40)
        hi.graph_json(quiet=True)
        with open(hi.GRAPH_JSON, encoding='utf-8') as fh: self.assertIn('"pulse_days":40,', fh.readline())

    def test_without_git_commits_are_not_counted_and_it_says_so(self):
        shutil.rmtree(os.path.join(self.root, '.git'))
        data = hi.pulse_data()
        self.assertEqual(data['git'], 'not a git repository')
        text = hi.pulse_text(data)
        self.assertIn('- Beta Launch — quiet 67 days (last: project card 2026-08-01); next step: Book the venue', text)
        self.assertIn('Git history not used here (not a git repository): commits were not counted.', text)

    def test_mentions_whole_words_and_short_aliases_by_case(self):
        self.put('harold/projects.md', self.fx['files']['harold/projects.md'] + '\n## Zed\n- folder: projects/zed\n- status: active\n- aliases: ZD\n')
        self.put('vault/daily/2026-10-01-a.md', '# A\n\nThe ZD numbers came in. Pilots everywhere.\n')
        self.put('vault/daily/2026-10-02-b.md', '# B\n\nzd lowercase is not the project.\n')
        hi.build(quiet=True)
        m = set(hi.graph_rows()['mentions'])
        self.assertIn(('vault/daily/2026-10-01-a.md', 'Zed'), m)
        self.assertNotIn(('vault/daily/2026-10-02-b.md', 'Zed'), m)
        self.assertNotIn(('vault/daily/2026-10-01-a.md', 'Pilot Program'), m)  # "Pilots" is not "the pilot"

    def test_a_roll_up_note_is_not_activity_for_every_project_it_names(self):
        self.put('vault/daily/2026-10-05-month-end.md', '# Month-end review\n\nPilot Program, Beta Launch, Delta and Echo: all reviewed.\n')
        self.put('vault/daily/2026-10-05-delta.md', '# Delta: first call\n\nAlso touched on Pilot Program, Beta Launch and Echo.\n')
        hi.build(quiet=True)
        m = set(hi.graph_rows()['mentions'])
        self.assertFalse({x for x in m if x[0] == 'vault/daily/2026-10-05-month-end.md'})   # four projects, none in a heading
        self.assertEqual({p for s, p in m if s == 'vault/daily/2026-10-05-delta.md'}, {'Delta'})  # named in the title

    def test_next_step_parsing(self):
        self.assertEqual(hi.fm_next_step('---\nnext_step: "call Jane"\n---\n# X\n'), 'call Jane')
        self.assertEqual(hi.fm_next_step('---\nnext_step:   # one line\n---\n'), '')
        self.assertEqual(hi.body_next_step('# X\n\n**Next step:** send the deck\n'), 'send the deck')
        self.assertEqual(hi.body_next_step('# X\n- Next steps: book it\n'), 'book it')
        self.assertEqual(hi.body_next_step('# X\n\n## Next step\n\n1. [x] sign the NDA\n'), 'sign the NDA')
        self.assertEqual(hi.body_next_step('# X\n<!-- Next step: hidden -->\n```\nNext step: code\n```\n'), '')
        self.assertEqual(hi.body_next_step('# X\nNext steps need an API key.\n'), '')
        self.assertEqual(hi.clean_step('{{what happens next}}'), '')
        self.assertEqual(len(hi.clean_step('x' * 250)), 200)


if __name__ == '__main__':
    unittest.main()
