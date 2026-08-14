# The README hero. Record with:  vhs tapes/shelf.tape   (from the repo root)
#
# Runs against tapes/fixture.ts, not your real account: a fake HOME with a
# canned GitHub cache and three throwaway git repos. Nothing here touches the
# network, and no private repo name can end up in the gif.
#
# Terminal settings match ghostty on the machine this was shot on:
# Cascadia Code NF at 19, padding 12, swatch theme spider-verse.

Output .github/assets/shelf.gif

Set Shell "zsh"
Set FontFamily "Cascadia Code NF"
Set FontSize 19
Set Width 1200
Set Height 880
Set Padding 12
Set TypingSpeed 55ms
Set Theme { "name": "spider-verse", "background": "#0d0a1e", "foreground": "#ece9f7", "cursor": "#ff1f6b", "selection": "#272049", "black": "#1b1638", "red": "#b01c18", "green": "#2fbf7a", "yellow": "#d99a12", "blue": "#6b4fd6", "magenta": "#d6155a", "cyan": "#00a8cc", "white": "#c9c4dd", "brightBlack": "#5c5480", "brightRed": "#ff473c", "brightGreen": "#3dffa8", "brightYellow": "#ffc93c", "brightBlue": "#8b6cff", "brightMagenta": "#ff1f6b", "brightCyan": "#00d4ff", "brightWhite": "#ece9f7" }

# Build the demo world, then move into it. HOME is redirected before anything
# runs, so shelf reads the fixture config and cache instead of yours.
Hide
Type "SHELF=$PWD && bun tapes/fixture.ts > /dev/null && export HOME=$SHELF/tapes/fixtures/home && shelf() { bun $SHELF/shelf.ts $@ } && export PS1='%F{5}❯%f ' && cd ~ && clear"
Enter
Sleep 3s
Show

Sleep 1s
Type "shelf"
Sleep 500ms
Enter
Sleep 6s

Type "shelf show soundboard"
Sleep 500ms
Enter
Sleep 6s
