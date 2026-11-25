// Mo trang ung dung day du trong 1 tab moi khi bam vao icon extension.
// Dung tab (khong dung popup) de qua trinh tai khong bi ngat khi mat focus.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});
