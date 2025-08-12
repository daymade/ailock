# AILock CLI-Web Integration Documentation

## Overview
This document describes the integration between the AILock CLI tool and the AILock web backend, ensuring both repositories work together seamlessly.

## Architecture

### Repositories
- **CLI Repository**: `/Users/tiansheng/Workspace/js/ailock` (v1.5.1)
- **Web Repository**: `/Users/tiansheng/Workspace/js/ailock-web` 

### API Communication
The CLI communicates with the web backend through Supabase Edge Functions:
- **Base URL**: `https://woodccjkyacwceitkjby.supabase.co/functions/v1`
- **Endpoints**:
  - `POST /cli-auth-redeem` - Redeem authentication codes
  - `POST /cli-usage-track` - Track anonymous usage analytics
  - `GET /cli-status` - Check user status and quotas

## Configuration

### CLI Configuration
The CLI can be configured using environment variables:

```bash
# Copy .env.example to .env and customize
cp .env.example .env

# Override the API endpoint (optional)
export AILOCK_API_URL=https://your-supabase-url.supabase.co/functions/v1

# Enable debug mode
export AILOCK_DEBUG=true

# Force offline mode (skip API calls)
export AILOCK_OFFLINE=true
```

### Web Configuration
The web project uses a centralized version configuration in `src/config/cli-version.ts`:

```typescript
export const CLI_CONFIG = {
  version: '1.5.1',
  packageName: 'ailock',
  // ... other configuration
};
```

## Testing Integration

### Prerequisites
1. Ensure both repositories are cloned and up to date
2. Build the CLI: `cd /Users/tiansheng/Workspace/js/ailock && npm run build`
3. Ensure web backend is deployed to Supabase

### Running Integration Tests
```bash
# From the CLI repository
npm run test:integration
```

This will verify:
- API connectivity
- Edge function deployment
- Request/response compatibility
- Authentication flow

### Expected Output
```
✅ All tests passed! (6/6)
CLI-Web integration is working correctly.
```

## Version Management

### Updating CLI Version
When releasing a new CLI version:

1. Update version in CLI's `package.json`:
   ```json
   {
     "version": "1.5.2"
   }
   ```

2. Update web's version configuration:
   ```typescript
   // src/config/cli-version.ts
   export const CLI_CONFIG = {
     version: '1.5.2',
     // ...
   };
   ```

3. Publish to npm:
   ```bash
   npm publish
   ```

## API Contract

### Authentication Code Redemption
**Request**:
```typescript
POST /cli-auth-redeem
{
  code: string;
  machine_uuid?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  user?: {
    email: string;
    quota_limit: number;
    quota_used: number;
  };
  error?: string;
}
```

### Usage Tracking
**Request**:
```typescript
POST /cli-usage-track
{
  machine_uuid: string;
  event_type: 'lock_attempt_blocked' | 'directory_locked' | 'directory_unlocked' | 'status_check';
  directory_path?: string;
  total_locked_count?: number;
  metadata?: Record<string, any>;
}
```

**Response**:
```typescript
{
  success: boolean;
  error?: string;
}
```

### Status Check
**Request**:
```typescript
GET /cli-status?code={auth_code}
```

**Response**:
```typescript
{
  activated: boolean;
  quota_limit: number;
  quota_used: number;
  available_codes: number;
}
```

## Troubleshooting

### Common Issues

1. **API Connection Failures**
   - Check if the Supabase URL is correct in `CliApiService.ts`
   - Verify Edge Functions are deployed: `supabase functions list`
   - Check network connectivity and proxy settings

2. **Version Mismatches**
   - Ensure global npm installation matches local version
   - Update with: `npm install -g ailock@latest`

3. **Authentication Failures**
   - Verify the auth code is valid and unused
   - Check Supabase service role key configuration
   - Review Edge Function logs in Supabase dashboard

### Debug Mode
Enable debug logging for troubleshooting:
```bash
export AILOCK_DEBUG=true
ailock auth YOUR-CODE
```

## Development Workflow

### Local Development
1. Start local Supabase:
   ```bash
   cd ailock-web
   supabase start
   ```

2. Set CLI to use local API:
   ```bash
   export AILOCK_API_URL=http://localhost:54321/functions/v1
   ```

3. Test integration:
   ```bash
   npm run test:integration
   ```

### Deployment
1. Deploy Edge Functions:
   ```bash
   supabase functions deploy cli-auth-redeem
   supabase functions deploy cli-usage-track
   supabase functions deploy cli-status
   ```

2. Update production URL in CLI if needed

3. Run integration tests against production

## Monitoring

### Analytics
- CLI usage events are tracked via Mixpanel
- Dashboard available at: https://ailock.app/dashboard
- Key metrics: auth redemptions, usage patterns, error rates

### Error Tracking
- Sentry integration in web project
- CLI errors logged when `AILOCK_DEBUG=true`

## Security Considerations

1. **API Keys**: Never commit Supabase service role keys
2. **Machine UUID**: Hashed for privacy before storage
3. **Directory Paths**: Sanitized and hashed for analytics
4. **Auth Codes**: Single-use, time-limited tokens

## Maintenance

### Regular Tasks
- [ ] Weekly: Check integration test status
- [ ] Monthly: Review analytics for usage patterns
- [ ] Quarterly: Update dependencies and security patches
- [ ] On Release: Sync version numbers between repos

### CI/CD Integration
Add to GitHub Actions:
```yaml
- name: Test CLI-Web Integration
  run: |
    npm run build
    npm run test:integration
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/daymade/ailock/issues
- Documentation: https://ailock.app/docs
- Email: support@ailock.app