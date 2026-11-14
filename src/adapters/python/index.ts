import type { LanguageAdapter, TestFileModel } from '../../core/types.js';

/**
 * pytest adapter — PLANNED (see ROADMAP in README).
 *
 * The rule engine is language-neutral: an adapter only has to turn a test file
 * into a `TestFileModel`. For pytest that means mapping:
 *   - `def test_*` / `class Test*` methods        -> TestCase
 *   - `assert a == b`, `assert x`, `pytest.raises` -> Assertion (matcherKind 'equal' | 'truthy' | 'throws')
 *   - `@pytest.mark.skip` / `xfail`               -> modifier 'skip'
 *   - `mocker.patch('pkg.unit.fn')` / `@patch`    -> ModuleMock / MockSetup
 *   - `mock.return_value = x`                     -> MockSetup { configuresReturn: true }
 * Mutation: operator flips via Python's own `ast` module in a subprocess.
 *
 * Until then, Python test files are discovered and reported as "not yet supported"
 * instead of being silently ignored.
 */
export const pythonAdapter: LanguageAdapter = {
  id: 'python',
  extensions: ['.py'],
  planned: true,
  isTestFile(path) {
    return /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path.replace(/\\/g, '/'));
  },
  parseTestFile(path: string, source: string): TestFileModel {
    return { file: path, language: 'python', tests: [], moduleMocks: [], unitSpies: [], lines: source.split(/\r?\n/) };
  },
};
