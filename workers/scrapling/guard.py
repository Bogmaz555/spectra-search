"""Reject non-public URLs before a worker library is allowed to connect."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

class GuardError(Exception):
    pass


_BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".localdomain")
_BLOCKED_HOSTS = {"localhost", "localhost.localdomain", "metadata.google.internal"}


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _is_public(mapped)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_public_url(url: str) -> str:
    """Return the URL only when every resolved address is public HTTP(S)."""
    raw = (url or "").strip()
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"}:
        raise GuardError("Tylko http i https")
    if parsed.username or parsed.password:
        raise GuardError("Adres z loginem jest odrzucony")
    host = parsed.hostname
    if not host:
        raise GuardError("Brak hosta")
    host_l = host.lower().rstrip(".")
    if host_l in _BLOCKED_HOSTS or host_l.endswith(_BLOCKED_SUFFIXES):
        raise GuardError("Host lokalny")
    try:
        literal = ipaddress.ip_address(host_l)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(literal):
            raise GuardError("Adres IP nie jest publiczny")
        return raw
    try:
        infos = socket.getaddrinfo(host_l, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise GuardError("DNS nie powiódł się") from exc
    if not infos:
        raise GuardError("DNS nie zwrócił adresu")
    for info in infos:
        addr = str(info[4][0]).split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError as exc:
            raise GuardError("DNS zwrócił nieznany adres") from exc
        if not _is_public(ip):
            raise GuardError("DNS wskazuje adres prywatny")
    return raw
