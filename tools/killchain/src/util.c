#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Returns 1 if str is a valid dotted-quad IPv4 address, 0 otherwise */
int is_valid_ip(const char *str) {
  char buf[64];
  strncpy(buf, str, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';

  char *token;
  char *rest = buf;
  int octets = 0;
  while ((token = strtok(rest, ".")) != NULL) {
    rest = NULL;
    if (++octets > 4)
      return 0;
    char *end;
    long val = strtol(token, &end, 10);
    if (*end != '\0' || val < 0 || val > 255)
      return 0;
  }
  if (octets != 4)
    return 0;

  return 1;
}

void get_current_datetime(char *buffer, size_t length) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  (void)strftime(buffer, length, "%Y-%m-%d %H:%M:%S", t);
}
