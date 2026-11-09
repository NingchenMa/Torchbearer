#!/bin/bash
# One-time: create the three role groups in the Cognito user pool, and (optionally) put every
# existing user who has no role yet into 'supervisor' so nobody is locked out when roles go live.
# Usage: scripts/setup-roles.sh              create the groups only
#        scripts/setup-roles.sh --existing   also add existing users with no group to 'supervisor'
# Afterwards, move people to their real role: scripts/set-role.sh <email> <role>
set -euo pipefail
POOL=${COGNITO_USER_POOL_ID:-us-east-1_YyfcIjRiS}
A="aws --region us-east-1 cognito-idp"
for g in supervisor expert learner; do
  $A create-group --user-pool-id "$POOL" --group-name "$g" --description "Torchbearer role: $g" >/dev/null 2>&1 && echo "created $g" || echo "$g exists"
done
if [ "${1:-}" = "--existing" ]; then
  for u in $($A list-users --user-pool-id "$POOL" --query 'Users[].Username' --output text); do
    groups=$($A admin-list-groups-for-user --user-pool-id "$POOL" --username "$u" --query 'Groups[].GroupName' --output text)
    if [ -z "$groups" ]; then
      $A admin-add-user-to-group --user-pool-id "$POOL" --username "$u" --group-name supervisor && echo "$u -> supervisor"
    fi
  done
fi
