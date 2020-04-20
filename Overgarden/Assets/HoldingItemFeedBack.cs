using System.Linq;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class HoldingItemFeedBack : MonoBehaviour
{
    public ItemFeedback[] items;
    public GameObject feedbackCanvas;
    public Image feedbackImage;

    private Dictionary<HoldingItem, Sprite> feedbackDict;

    private void Start()
    {
        feedbackCanvas.SetActive(false);
        feedbackDict = new Dictionary<HoldingItem, Sprite>();
        foreach (ItemFeedback item in items)
        {
            feedbackDict.Add(item.itemLabel, item.itemSprite);
        }
    }

    private void Update()
    {
        HoldingItem currentHoldingItem = GetComponent<EventsManager>().holdingItem;
        if (feedbackDict.Keys.ToArray().Contains(currentHoldingItem))
        {
            feedbackCanvas.SetActive(true);
            if (currentHoldingItem == HoldingItem.PLANT)
            {
                feedbackImage.sprite = GetComponent<EventsManager>().holdingPlant.main;
            }
            else
            {
                feedbackImage.sprite = feedbackDict[currentHoldingItem];
            }
        }
        else
        {
            feedbackCanvas.SetActive(false);
        }
    }
}

[System.Serializable]
public class ItemFeedback
{
    public HoldingItem itemLabel;
    public Sprite itemSprite;
}
