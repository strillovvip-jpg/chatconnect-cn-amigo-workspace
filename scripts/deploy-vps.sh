#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C
export COPYFILE_DISABLE=1

required_variables=(
  CN_VPS_HOST
  CN_VPS_USER
  CN_VPS_WEBROOT
  CN_DOMAIN
  CN_SSH_KEY
  CN_CONVEX_CLOUD_HOST
  CN_CONVEX_SITE_HOST
)
for variable_name in "${required_variables[@]}"; do
  if test -z "${!variable_name:-}"; then
    echo "Missing required deployment variable: $variable_name" >&2
    exit 2
  fi
done
CN_ENABLE_WWW="${CN_ENABLE_WWW:-0}"

if [[ ! "$CN_VPS_HOST" =~ ^[A-Za-z0-9.-]+$ ]] ||
  [[ ! "$CN_VPS_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] ||
  [[ ! "$CN_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] ||
  [[ ! "$CN_CONVEX_CLOUD_HOST" =~ ^[A-Za-z0-9.-]+\.convex\.cloud$ ]] ||
  [[ ! "$CN_CONVEX_SITE_HOST" =~ ^[A-Za-z0-9.-]+\.convex\.site$ ]]; then
  echo "One or more deployment host values are invalid." >&2
  exit 2
fi
if [[ "$CN_ENABLE_WWW" != "0" && "$CN_ENABLE_WWW" != "1" ]]; then
  echo "CN_ENABLE_WWW must be 0 or 1." >&2
  exit 2
fi
if [[ ! "$CN_VPS_WEBROOT" =~ ^/var/www/[A-Za-z0-9._-]+$ ]]; then
  echo "CN_VPS_WEBROOT must be a dedicated directory directly under /var/www/." >&2
  exit 2
fi
if test ! -f "$CN_SSH_KEY"; then
  echo "CN_SSH_KEY does not point to a readable private key." >&2
  exit 2
fi

readonly DEPLOY_TARGET="${CN_VPS_USER}@${CN_VPS_HOST}"
readonly PUBLIC_URL="https://${CN_DOMAIN}"
readonly NGINX_TEMPLATE="deploy/nginx-chatconnect.conf"
server_names="$CN_DOMAIN"
if [[ "$CN_ENABLE_WWW" == "1" ]]; then
  server_names="$CN_DOMAIN www.$CN_DOMAIN"
fi
temporary_directory=$(mktemp -d "/tmp/chatconnect-cn-deploy.XXXXXX")
archive_path="$temporary_directory/chatconnect-cn-dist.tar.gz"
nginx_path="$temporary_directory/chatconnect-cn-nginx.conf"
trap 'rm -rf "$temporary_directory"' EXIT

test -f dist/index.html
test -d dist/assets
test -f "$NGINX_TEMPLATE"

sed \
  -e "s|__CN_DOMAIN__|$CN_DOMAIN|g" \
  -e "s|__CN_SERVER_NAMES__|$server_names|g" \
  -e "s|__CN_WEBROOT__|$CN_VPS_WEBROOT|g" \
  -e "s|__CN_CONVEX_SITE_HOST__|$CN_CONVEX_SITE_HOST|g" \
  "$NGINX_TEMPLATE" > "$nginx_path"
if grep -Eq '__CN_[A-Z_]+__' "$nginx_path"; then
  echo "The rendered Nginx configuration still contains placeholders." >&2
  exit 2
fi

tar --no-xattrs -czf "$archive_path" -C dist .
checksum=$(shasum -a 256 "$archive_path" | awk '{print $1}')
asset=$(grep -oE '/assets/index-[^" ]+\.js' dist/index.html | head -1)
test -n "$asset"
remote_archive="/tmp/chatconnect-cn-${checksum}.tar.gz"
remote_nginx="/tmp/chatconnect-cn-${checksum}.nginx.conf"

scp -i "$CN_SSH_KEY" -o IdentitiesOnly=yes "$archive_path" "$DEPLOY_TARGET:$remote_archive"
scp -i "$CN_SSH_KEY" -o IdentitiesOnly=yes "$nginx_path" "$DEPLOY_TARGET:$remote_nginx"
ssh -i "$CN_SSH_KEY" -o IdentitiesOnly=yes "$DEPLOY_TARGET" "bash -s" -- "$CN_VPS_WEBROOT" "$remote_archive" "$checksum" "$asset" "$PUBLIC_URL" "$remote_nginx" "$CN_CONVEX_CLOUD_HOST" <<'REMOTE'
set -euo pipefail
webroot=$1
archive=$2
expected_checksum=$3
expected_asset=$4
public_url=$5
nginx_config=$6
expected_convex_host=$7

if [[ ! "$webroot" =~ ^/var/www/[A-Za-z0-9._-]+$ ]]; then
  echo "Unsafe webroot rejected." >&2
  exit 2
fi
actual_checksum=$(sha256sum "$archive" | awk '{print $1}')
test "$actual_checksum" = "$expected_checksum"

mkdir -p "$webroot"
if test -n "$(find "$webroot" -mindepth 1 -maxdepth 1 -print -quit)"; then
  cp -a "$webroot" "${webroot}.backup.$(date +%Y%m%d-%H%M%S)"
fi

staging=$(mktemp -d "${webroot}.staging.XXXXXX")
public_html=$(mktemp)
public_js=$(mktemp)
trap 'rm -rf "$staging"; rm -f "$public_html" "$public_js" "$archive" "$nginx_config"' EXIT
tar -xzf "$archive" -C "$staging"
test -f "$staging/index.html"
test -f "$staging$expected_asset"

find "$webroot" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$staging"/. "$webroot"/
chown -R www-data:www-data "$webroot"
find "$webroot" -type d -exec chmod 755 {} +
find "$webroot" -type f -exec chmod 644 {} +

install -m 644 "$nginx_config" /etc/nginx/sites-available/chatconnect-cn
ln -sfn /etc/nginx/sites-available/chatconnect-cn /etc/nginx/sites-enabled/chatconnect-cn

nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx

deployed_asset=$(grep -oE '/assets/index-[^" ]+\.js' "$webroot/index.html" | head -1)
test "$deployed_asset" = "$expected_asset"
curl -fsSL --connect-timeout 15 -H 'Cache-Control: no-cache' "$public_url/?deployment=$(date +%s)" -o "$public_html"
public_asset=$(grep -oE '/assets/index-[^" ]+\.js' "$public_html" | head -1)
test "$public_asset" = "$expected_asset"
curl -fsSL --connect-timeout 15 "$public_url$public_asset" -o "$public_js"
grep -Fq "$expected_convex_host" "$public_js"
echo "DEPLOY_SUCCESS $public_asset"
REMOTE
