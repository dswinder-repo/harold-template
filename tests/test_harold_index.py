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


if __name__ == '__main__':
    unittest.main()
