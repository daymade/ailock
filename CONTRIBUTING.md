# Contributing to AI-Proof File Guard (ailock)

Thank you for your interest in contributing to ailock! We welcome contributions from the community and are excited to work with you.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please be respectful and considerate in all interactions.

## How to Contribute

### Reporting Issues

1. Check if the issue already exists in the [issue tracker](https://github.com/daymade/ailock/issues)
2. Create a new issue with a clear title and description
3. Include steps to reproduce, expected behavior, and actual behavior
4. Add relevant labels (bug, enhancement, documentation, etc.)

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes following our coding standards
4. Write or update tests as needed
5. Update documentation if applicable
6. Commit with clear messages: `git commit -m "feat: add new feature"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Create a Pull Request with a clear description

### Development Setup

```bash
# Clone the repository
git clone https://github.com/daymade/ailock.git
cd ailock

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

### Coding Standards

- Use TypeScript for all new code
- Follow existing code style and patterns
- Ensure all tests pass: `npm test`
- Add tests for new features
- Update documentation for API changes

### Commit Message Guidelines

We follow conventional commits:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Test additions or changes
- `chore:` Build process or auxiliary tool changes

### Testing

- Write unit tests for new functions and modules
- Write integration tests for new commands
- Ensure cross-platform compatibility
- Test on different operating systems when possible

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create a release PR
4. After merge, tag the release: `git tag v1.x.x`
5. Push tags: `git push --tags`
6. Publish to npm: `npm publish`

## Questions?

Feel free to ask questions in:
- GitHub Issues for bugs and features
- Discussions for general questions
- Pull Request comments for code-specific questions

Thank you for contributing to ailock!