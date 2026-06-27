from __future__ import annotations

import hashlib
import hmac
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

from app.config import Settings


class AdminGuard:
    """Constant-time credential check with a small in-memory failure limiter."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.failures: dict[str, deque[float]] = defaultdict(deque)

    @property
    def enabled(self) -> bool:
        return bool(self.settings.admin_password or self.settings.admin_password_sha256)

    def _expected_matches(self, supplied: str) -> bool:
        if self.settings.admin_password_sha256:
            supplied_hash = hashlib.sha256(supplied.encode("utf-8")).hexdigest()
            return hmac.compare_digest(supplied_hash, self.settings.admin_password_sha256.lower())
        return hmac.compare_digest(supplied, self.settings.admin_password)

    def verify(self, supplied: str, client_key: str) -> None:
        if not self.enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Administrator retraining is disabled until ADMIN_PASSWORD or ADMIN_PASSWORD_SHA256 is configured.",
            )

        now = time.monotonic()
        bucket = self.failures[client_key]
        while bucket and now - bucket[0] > 600:
            bucket.popleft()
        if len(bucket) >= 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed administrator attempts. Try again later.",
            )

        if not supplied or not self._expected_matches(supplied):
            bucket.append(now)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid administrator credential.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        bucket.clear()
