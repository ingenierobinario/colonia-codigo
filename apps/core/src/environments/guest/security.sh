#!/bin/sh
set -eu
# The Lima administrator and its credentials never share the desktop user's home.
worker=colonia-worker
if ! command -v nft >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends nftables
fi
# Older lab desktops ran as the administrator; the protected desktop never shares that session.
pkill -u 1000 -x Xtigervnc 2>/dev/null || true
pkill -u 1000 -x xfce4-session 2>/dev/null || true
if ! id "$worker" >/dev/null 2>&1; then useradd --uid 1001 --create-home --shell /bin/bash "$worker"; fi
[ "$(id -u "$worker")" = 1001 ]
[ "$(id -G "$worker")" = "$(id -g "$worker")" ]
passwd --lock "$worker" >/dev/null
chmod 700 /home/colonia-worker
chmod 700 /home/colonia /mnt
# No cloud-init on WSL, so no /var/lib/cloud there.
[ ! -d /var/lib/cloud ] || chmod 700 /var/lib/cloud
install -d -m 755 /etc/colonia-computer
sudo -n -u "$worker" -H mkdir -p /home/colonia-worker/work
if [ -d /home/colonia/work ] && [ ! -f /etc/colonia-computer/work-imported ]; then
  tar -C /home/colonia/work -cf - . | sudo -n -u "$worker" -H sh -c 'cd /home/colonia-worker/work && tar --skip-old-files -xf -'
  touch /etc/colonia-computer/work-imported
fi
# The egress rules were written just before this script (guest-security.ts egressRules).
[ -s /etc/colonia-computer/egress.nft ]
chown root:root /etc/colonia-computer/egress.nft
chmod 600 /etc/colonia-computer/egress.nft
install -d -m 755 /usr/local/libexec
cat > /usr/local/libexec/colonia-computer-firewall <<'SCRIPT'
#!/bin/sh
set -eu
# Each table is replaced whole and atomically, never duplicated.
load() {
  if nft list table inet "$1" >/dev/null 2>&1; then
    { printf 'delete table inet %s\n' "$1"; cat "$2"; } | nft -f -
  else nft -f "$2"
  fi
}
load colonia_computer /etc/colonia-computer/egress.nft
# WSL mounts Windows drives under /mnt at each boot; only root goes past it.
chmod 700 /mnt
# Agents' loopback: a rule names an agent's slice, which must exist before the rule loads.
if [ -f /etc/colonia-computer/agents.nft ]; then
  for slice in $(grep -o 'user-[0-9]*\.slice' /etc/colonia-computer/agents.nft | sort -u); do systemctl start "$slice"; done
  load colonia_loopback /etc/colonia-computer/agents.nft
fi
SCRIPT
chmod 755 /usr/local/libexec/colonia-computer-firewall
cat > /etc/systemd/system/colonia-computer-firewall.service <<'UNIT'
[Unit]
Description=Colonia computer egress boundary
Before=user@1001.service
After=local-fs.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/libexec/colonia-computer-firewall
[Install]
WantedBy=multi-user.target
UNIT
# The egress proxy's guest port is PID 1's from boot, before any user's session, so no agent can take it first. Its relay
# reaches the host's tunnel through a socket only the Lima user (uid 1000) can create (egress-tunnel.ts).
cat > /etc/tmpfiles.d/colonia-egress.conf <<'CONF'
d /run/colonia-egress 0700 1000 1000 -
CONF
systemd-tmpfiles --create /etc/tmpfiles.d/colonia-egress.conf
cat > /etc/systemd/system/colonia-proxy.socket <<'UNIT'
[Unit]
Description=Colonia computer egress proxy port
[Socket]
ListenStream=127.0.0.1:3128
FreeBind=yes
[Install]
WantedBy=sockets.target
UNIT
cat > /etc/systemd/system/colonia-proxy.service <<'UNIT'
[Unit]
Description=Colonia computer egress proxy relay
Requires=colonia-proxy.socket
After=colonia-proxy.socket
[Service]
User=1000
ExecStart=/usr/lib/systemd/systemd-socket-proxyd /run/colonia-egress/proxy.sock
UNIT
# An agent runs only while it has a screen: no agent's session comes back by itself when the computer boots.
cat > /etc/systemd/system/colonia-agents-boot.service <<'UNIT'
[Unit]
Description=Colonia agents start only with a screen
DefaultDependencies=no
After=local-fs.target
Before=systemd-logind.service
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'rm -f /var/lib/systemd/linger/colonia-a*'
[Install]
WantedBy=systemd-logind.service
UNIT
# Every user's session, the owner's screen and each agent's, waits for the firewall and the proxy's port.
rm -rf /etc/systemd/system/user@1001.service.d
install -d -m 755 /etc/systemd/system/user@.service.d
cat > /etc/systemd/system/user@.service.d/firewall.conf <<'UNIT'
[Unit]
Requires=colonia-computer-firewall.service colonia-proxy.socket
After=colonia-computer-firewall.service colonia-proxy.socket
UNIT
systemctl daemon-reload
systemctl enable colonia-computer-firewall.service colonia-agents-boot.service
systemctl restart colonia-computer-firewall.service
systemctl enable --now colonia-proxy.socket
loginctl enable-linger "$worker"
systemctl start user@1001.service
# Lock down optional system helpers as well as sudo, including privileged desktop actions.
install -d -m 755 /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/00-colonia-worker.rules <<'RULES'
polkit.addRule(function(action, subject) {
  if (subject.user == "colonia-worker" || /^colonia-a[0-9]+$/.test(subject.user)) return polkit.Result.NO;
});
RULES
if sudo -n -u "$worker" sudo -n true 2>/dev/null; then echo 'Worker has administrative access' >&2; exit 1; fi
